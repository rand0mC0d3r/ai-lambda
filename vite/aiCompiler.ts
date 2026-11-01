import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import type { Plugin } from 'vite';
import { inferSchema } from './comparator/inferSchema.ts';
import { generateComparator } from './openai/generateComparator.ts';
import type { AIConfig } from './types.ts';

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

      let hasSortAiCall = false;

      function findSortAiCall(node: ts.Node): void {
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === 'sortAi'
        ) {
          hasSortAiCall = true;
          return;
        }

        ts.forEachChild(node, findSortAiCall);
      }

      findSortAiCall(ast);

      if (!hasSortAiCall) return null;

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
        throw new Error(`Unable to type-check sortAi() in ${id}`);
      }

      const checker = program.getTypeChecker();
      const replacements: {
        start: number;
        end: number;
        value: string;
      }[] = [];

      async function visit(node: ts.Node): Promise<void> {
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === 'sortAi'
        ) {
          const [items, instructionNode] = node.arguments;

          if (
            !items ||
            !instructionNode ||
            !ts.isStringLiteral(instructionNode) ||
            node.arguments.length !== 2
          ) {
            throw new Error(
              `Invalid sortAi() invocation in ${id}`
            );
          }

          const schema = inferSchema(checker, items);

          const comparator = await generateComparator(
            config,
            root,
            instructionNode.text,
            schema
          );

          replacements.push({
            start: node.getStart(ast),
            end: node.end,
            value: `${items.getText(ast)}.toSorted(${comparator})`
          });

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
