import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import type { Plugin } from 'vite';
import { inferSchema } from './comparator/inferSchema.js';
import { aiFunctionSpecs } from './aiFunctions.js';
import { generateAiFunction } from './openai/generateAiFunction.js';
import type { AIConfig } from './types.js';

function isAiCall(
  node: ts.Node
): node is ts.CallExpression & {
  expression: ts.PropertyAccessExpression;
} {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    Object.hasOwn(aiFunctionSpecs, node.expression.name.text)
  );
}

export function aiCompiler(): Plugin {
  let config: AIConfig;
  let root: string;
  let tsconfig: ts.ParsedCommandLine;

  return {
    name: 'ai-compile-time',
    enforce: 'pre',

    async configResolved(resolved) {
      root = resolved.root;

      const tsconfigPath = path.resolve(root, 'tsconfig.json');
      const tsconfigFile = ts.readConfigFile(
        tsconfigPath,
        ts.sys.readFile
      );

      if (tsconfigFile.error) {
        throw new Error(
          ts.flattenDiagnosticMessageText(
            tsconfigFile.error.messageText,
            '\n'
          )
        );
      }

      tsconfig = ts.parseJsonConfigFileContent(
        tsconfigFile.config,
        ts.sys,
        root,
        undefined,
        tsconfigPath
      );

      if (tsconfig.errors.length) {
        throw new Error(
          tsconfig.errors
            .map((diagnostic) =>
              ts.flattenDiagnosticMessageText(
                diagnostic.messageText,
                '\n'
              )
            )
            .join('\n')
        );
      }

      const configPath = path.resolve(root, '.ai-rc.json');

      config = JSON.parse(
        await readFile(configPath, 'utf8')
      );

      if (!config.apiKey) {
        throw new Error('Missing OpenAI API key in .ai-rc.json');
      }

      config.model ||= 'gpt-4.1-mini';
      config.cache ??= true;
      config.generatedDir ||= '.ai-cache';
    },

    async transform(source, id) {
      if (
        id.includes('node_modules') ||
        !/\.[jt]sx?$/.test(id)
      ) {
        return null;
      }

      const ast = ts.createSourceFile(
        id,
        source,
        ts.ScriptTarget.Latest,
        true
      );

      let hasAiCall = false;

      function findAiCall(node: ts.Node): void {
        if (isAiCall(node)) {
          hasAiCall = true;
          return;
        }

        ts.forEachChild(node, findAiCall);
      }

      findAiCall(ast);

      if (!hasAiCall) return null;

      const compilerHost = ts.createCompilerHost(tsconfig.options);
      const getSourceFile = compilerHost.getSourceFile.bind(compilerHost);

      compilerHost.getSourceFile = (
        fileName,
        languageVersionOrOptions,
        onError,
        shouldCreateNewSourceFile
      ) => {
        if (path.resolve(fileName) === path.resolve(id)) {
          return ts.createSourceFile(
            fileName,
            source,
            languageVersionOrOptions,
            true
          );
        }

        return getSourceFile(
          fileName,
          languageVersionOrOptions,
          onError,
          shouldCreateNewSourceFile
        );
      };

      const program = ts.createProgram({
        rootNames: tsconfig.fileNames,
        options: tsconfig.options,
        host: compilerHost
      });
      const programSource = program.getSourceFiles().find(
        (file) => path.resolve(file.fileName) === path.resolve(id)
      );

      if (!programSource) {
        throw new Error(`Unable to type-check AI call in ${id}`);
      }

      const checker = program.getTypeChecker();
      const replacements: {
        start: number;
        end: number;
        value: string;
      }[] = [];

      async function visit(node: ts.Node): Promise<void> {
        if (isAiCall(node)) {
          const spec = aiFunctionSpecs[node.expression.name.text];
          const instructionNode = node.arguments[0];
          const items = node.expression.expression;

          if (
            !instructionNode ||
            !ts.isStringLiteral(instructionNode) ||
            node.arguments.length !== 1 ||
            (node.typeArguments && spec.kind !== 'map')
          ) {
            throw new Error(
              `Invalid ${spec.method}() invocation in ${id}`
            );
          }

          const schema = inferSchema(checker, items, spec.method);

          const generated = await generateAiFunction(
            config,
            root,
            spec,
            instructionNode.text,
            schema
          );

          // Only the method tail is replaced so nested AI calls in the receiver stay intact.
          const typeArguments = node.typeArguments
            ? `<${node.typeArguments.map((type) => type.getText(ast)).join(', ')}>`
            : '';

          replacements.push({
            start: items.end,
            end: node.end,
            value: `.${spec.replacementMethod}${typeArguments}(${generated})`
          });

          await visit(items);
          return;
        }

        for (const child of node.getChildren(ast)) {
          await visit(child);
        }
      }

      await visit(programSource);

      if (!replacements.length) return null;

      let output = source;

      for (const replacement of replacements.sort(
        (a, b) => b.start - a.start
      )) {
        output =
          output.slice(0, replacement.start) +
          replacement.value +
          output.slice(replacement.end);
      }

      return {
        code: output,
        map: null
      };
    }
  };
}
