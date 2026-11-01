import MagicString from 'magic-string';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type {
    CallExpression,
    Node,
    PropertyAccessExpression
} from 'typescript/unstable/ast';
import {
    isCallExpression,
    isPropertyAccessExpression,
    isStringLiteral
} from 'typescript/unstable/ast/is';
import {
    API,
    type Snapshot
} from 'typescript/unstable/sync';
import type { Plugin } from 'vite';
import {
    AI_CONFIG_FILE,
    aiFunctionSpecs,
    DEFAULT_GENERATED_DIR,
    DEFAULT_MODEL,
    TSCONFIG_FILE,
    VITE_PLUGIN_NAME
} from './constants.js';
import {
    inferAccumulatorSchema,
    inferSchema
} from './comparator/inferSchema.js';
import {
    createConfigurationError,
    createTransformError
} from './errorContext.js';
import { generateAiFunction } from './openai/generateAiFunction.js';
import type { AIConfig } from './types.js';

function isAiCall(
  node: Node
): node is CallExpression & {
  expression: PropertyAccessExpression;
} {
  return (
    isCallExpression(node) &&
    isPropertyAccessExpression(node.expression) &&
    Object.hasOwn(aiFunctionSpecs, node.expression.name.text)
  );
}

/**
 * Creates a Vite plugin that compiles `sortAi`, `filterAi`, `mapAi`, and
 * `reduceAi` array calls into native array operations during the build.
 *
 * The plugin reads `tsconfig.json` and `.ai-rc.json` from Vite's resolved root.
 * The config file must contain an OpenAI `apiKey`; `model`, `cache`, and
 * `generatedDir` are optional and default to `gpt-4.1-mini`, `true`, and
 * `.ai-cache`. On a cache miss, the instruction and inferred type schema are
 * sent to OpenAI, but array contents are not. Generated functions are
 * validated before the call is rewritten.
 *
 * @returns A Vite plugin that performs the AI call transformations.
 *
 * @example Simple Vite setup
 * ```ts
 * import { defineConfig } from 'vite';
 * import { aiCompiler } from 'vite-plugin-ai-lambda';
 *
 * export default defineConfig({
 *   plugins: [aiCompiler()]
 * });
 * ```
 *
 * @example Advanced setup for an application in a monorepo
 * ```ts
 * import { defineConfig } from 'vite';
 * import react from '@vitejs/plugin-react';
 * import { aiCompiler } from 'vite-plugin-ai-lambda';
 *
 * // Keep tsconfig.json and .ai-rc.json in ./apps/store.
 * export default defineConfig({
 *   root: './apps/store',
 *   plugins: [react(), aiCompiler()]
 * });
 *
 * interface Order {
 *   customer: string;
 *   total: number;
 *   status: string;
 * }
 *
 * interface Array<T> {
 *   filterAi(instruction: string): T[];
 *   sortAi(instruction: string): T[];
 *   reduceAi<U>(instruction: string, initialValue: U): U;
 * }
 *
 * const revenue = orders
 *   .filterAi('Keep completed orders only.')
 *   .sortAi('Sort by total from highest to lowest.')
 *   .reduceAi<number>(
 *     'Add each order total to the running revenue.',
 *     0
 *   );
 * ```
 */
export function aiCompiler(): Plugin {
  let config: AIConfig;
  let root: string;
  let tsconfigPath: string;
  let api: API | undefined;
  let initialSnapshot: Snapshot | undefined;

  function getApi(): API {
    if (!api) {
      throw new Error('TypeScript API is not initialized');
    }

    return api;
  }

  return {
    name: VITE_PLUGIN_NAME,
    enforce: 'pre',

    async configResolved(resolved) {
      root = resolved.root;
      tsconfigPath = path.resolve(root, TSCONFIG_FILE);
      api = new API();

      try {
        api.parseConfigFile(tsconfigPath);
        initialSnapshot = api.updateSnapshot({
          openProjects: [tsconfigPath]
        });

        const project = initialSnapshot.getProject(tsconfigPath);

        if (!project) {
          throw new Error(`Unable to load TypeScript project ${tsconfigPath}`);
        }

        const diagnostics =
          project.program.getConfigFileParsingDiagnostics();

        if (diagnostics.length) {
          throw new Error(
            diagnostics.map((diagnostic) => diagnostic.text).join('\n')
          );
        }

        const configPath = path.resolve(root, AI_CONFIG_FILE);
        config = JSON.parse(await readFile(configPath, 'utf8'));

        if (!config.apiKey) {
          throw new Error('Missing OpenAI API key in .ai-rc.json');
        }

        config.model ||= DEFAULT_MODEL;
        config.cache ??= true;
        config.generatedDir ||= DEFAULT_GENERATED_DIR;
      } catch (error) {
        initialSnapshot?.dispose();
        api.close();
        api = undefined;
        throw createConfigurationError(error, root);
      }
    },

    async transform(source, id) {
      if (
        id.includes('node_modules') ||
        !/\.[jt]sx?$/.test(id) ||
        !Object.keys(aiFunctionSpecs).some((method) => source.includes(method))
      ) {
        return null;
      }

      const compilerApi = getApi();

      const snapshot = compilerApi.updateSnapshot({
        fileChanges: { changed: [id] }
      });

      try {
        const project = snapshot.getProject(tsconfigPath);
        const programSource = project?.program.getSourceFile(id);

        if (!project || !programSource) {
          throw new Error(`Unable to type-check AI call in ${id}`);
        }

        const activeProject = project;
        const activeSource = programSource;

        if (programSource.text !== source) {
          throw new Error(
            `Unable to type-check transformed AI call in ${id}: source does not match the TypeScript project`
          );
        }

        let hasAiCall = false;

        function findAiCall(node: Node): void {
          if (isAiCall(node)) {
            hasAiCall = true;
            return;
          }

          node.forEachChild(findAiCall);
        }

        findAiCall(programSource);

        if (!hasAiCall) return null;

        const replacements: {
          start: number;
          end: number;
          value: string;
        }[] = [];

        async function visit(node: Node): Promise<void> {
          if (isAiCall(node)) {
            const spec = aiFunctionSpecs[node.expression.name.text];
            const instructionNode = node.arguments[0];
            const items = node.expression.expression;
            const initialValue = node.arguments[1];

            try {
              if (
                !instructionNode ||
                !isStringLiteral(instructionNode) ||
                node.arguments.length !== (spec.kind === 'reduce' ? 2 : 1) ||
                (node.typeArguments &&
                  spec.kind !== 'map' &&
                  spec.kind !== 'reduce')
              ) {
                throw new Error(
                  `Invalid ${spec.method}() invocation in ${id}`
                );
              }

              const schema = inferSchema(
                activeProject.checker,
                items,
                spec.method
              );

              const accumulator = spec.kind === 'reduce' && initialValue
                ? inferAccumulatorSchema(
                  activeProject.checker,
                  initialValue,
                  spec.method,
                  node.typeArguments?.[0]
                )
                : undefined;
              const parameterSchemas = accumulator
                ? {
                  acc: accumulator,
                  item: { kind: 'object' as const, fields: schema }
                }
                : undefined;
              const generated = await generateAiFunction(
                config,
                root,
                spec,
                instructionNode.text,
                schema,
                compilerApi,
                parameterSchemas
              );

              const typeArguments =
                (spec.kind === 'map' || spec.kind === 'reduce') &&
                node.typeArguments
                ? `<${node.typeArguments.map((type) => type.getText(programSource)).join(', ')}>`
                : '';
              const reducerArguments = spec.kind === 'reduce'
                ? `, ${initialValue?.getText(programSource)}`
                : '';

              // Rewrite only the method tail so nested receiver calls stay intact.
              replacements.push({
                start: items.end,
                end: node.end,
                value: `.${spec.replacementMethod}${typeArguments}(${generated}${reducerArguments})`
              });
            } catch (error) {
              const location = activeSource.getLineAndCharacterOfPosition(
                node.getStart(activeSource)
              );
              throw createTransformError(error, {
                file: id,
                line: location.line + 1,
                column: location.character + 1,
                method: spec.method,
                instruction: instructionNode && isStringLiteral(instructionNode)
                  ? instructionNode.text
                  : '',
                model: config.model
              });
            }

            await visit(items);
            return;
          }

          const children: Node[] = [];
          node.forEachChild((child) => {
            children.push(child);
          });

          for (const child of children) {
            await visit(child);
          }
        }

        await visit(programSource);

        if (!replacements.length) return null;

        const output = new MagicString(source);

        for (const replacement of replacements.sort(
          (a, b) => b.start - a.start
        )) {
          output.overwrite(
            replacement.start,
            replacement.end,
            replacement.value
          );
        }

        return {
          code: output.toString(),
          map: output.generateMap({
            source: id,
            includeContent: true,
            hires: true
          })
        };
      } finally {
        snapshot.dispose();
      }
    },

    closeBundle() {
      initialSnapshot?.dispose();
      initialSnapshot = undefined;
      api?.close();
      api = undefined;
    },

    closeWatcher() {
      initialSnapshot?.dispose();
      initialSnapshot = undefined;
      api?.close();
      api = undefined;
    }
  };
}
