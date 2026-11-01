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
import { aiFunctionSpecs } from './aiFunctions.js';
import {
    inferAccumulatorSchema,
    inferSchema
} from './comparator/inferSchema.js';
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
    name: 'ai-compile-time',
    enforce: 'pre',

    async configResolved(resolved) {
      root = resolved.root;
      tsconfigPath = path.resolve(root, 'tsconfig.json');
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

        const configPath = path.resolve(root, '.ai-rc.json');
        config = JSON.parse(await readFile(configPath, 'utf8'));

        if (!config.apiKey) {
          throw new Error('Missing OpenAI API key in .ai-rc.json');
        }

        config.model ||= 'gpt-4.1-mini';
        config.cache ??= true;
        config.generatedDir ||= '.ai-cache';
      } catch (error) {
        initialSnapshot?.dispose();
        api.close();
        api = undefined;
        throw error;
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
