
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { defineConfig, type Plugin } from 'vite';

interface AIConfig {
  apiKey: string;
  model: string;
  cache: boolean;
  generatedDir: string;
}

function aiCompiler(): Plugin {
  let config: AIConfig;
  let root: string;

  const hash = (value: string) =>
    createHash('sha256').update(value).digest('hex');

  async function generateComparator(
    instruction: string,
    schema: Record<string, string>
  ): Promise<string> {
    const cacheKey = hash(JSON.stringify({
      instruction,
      schema,
      model: config.model,
      compilerVersion: 1
    }));

    const cacheDir = path.resolve(root, config.generatedDir);
    const cacheFile = path.join(cacheDir, `${cacheKey}.json`);

    if (config.cache) {
      try {
        const cached = await readFile(cacheFile, 'utf8');
        return JSON.parse(cached).comparator;
      } catch {
        // Cache miss.
      }
    }

    console.log(`\n🤖 AI compiling: "${instruction}"`);

    const response = await fetch(
      'https://api.openai.com/v1/responses',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: config.model,
          instructions: `
You are a JavaScript comparator compiler.

Generate a single JavaScript arrow function:
(a, b) => ...

Rules:
- Return a negative number when a comes first.
- Return zero when equivalent.
- Return a positive number when b comes first.
- Only access fields defined in the supplied schema.
- Use arithmetic for numeric comparisons.
- Use localeCompare with numeric:true and sensitivity:"base"
  for natural string sorting.
- No external dependencies.
- No mutations.
- No additional variables or statements.
- Output JavaScript code only inside the JSON field.
          `,
          input: JSON.stringify({
            instruction,
            schema,
            availableVariables: ['a', 'b']
          }),
          text: {
            format: {
              type: 'json_schema',
              name: 'sort_comparator',
              strict: true,
              schema: {
                type: 'object',
                properties: {
                  comparator: {
                    type: 'string'
                  }
                },
                required: ['comparator'],
                additionalProperties: false
              }
            }
          }
        })
      }
    );

    if (!response.ok) {
      throw new Error(
        `OpenAI error ${response.status}: ${await response.text()}`
      );
    }

    const result = await response.json();

    const output = result.output_text;

    if (!output) {
      throw new Error('OpenAI returned no generated code');
    }

    const { comparator } = JSON.parse(output);

    validateComparator(comparator, schema);

    if (config.cache) {
      await mkdir(cacheDir, { recursive: true });

      await writeFile(
        cacheFile,
        JSON.stringify({ comparator }, null, 2)
      );
    }

    console.log(`✅ Generated: ${comparator}`);

    return comparator;
  }

  function validateComparator(
    code: string,
    schema: Record<string, string>
  ) {
    const source = ts.createSourceFile(
      'generated.ts',
      `const __comparator = ${code};`,
      ts.ScriptTarget.ESNext,
      true
    );

    if (source.parseDiagnostics.length) {
      throw new Error('Invalid generated JavaScript syntax');
    }

    const declaration = source.statements[0];

    if (!ts.isVariableStatement(declaration)) {
      throw new Error('Invalid comparator declaration');
    }

    const initializer =
      declaration.declarationList.declarations[0]?.initializer;

    if (
      !initializer ||
      !ts.isArrowFunction(initializer) ||
      initializer.parameters.length !== 2 ||
      !ts.isIdentifier(initializer.parameters[0].name) ||
      !ts.isIdentifier(initializer.parameters[1].name) ||
      initializer.parameters[0].name.text !== 'a' ||
      initializer.parameters[1].name.text !== 'b' ||
      ts.isBlock(initializer.body)
    ) {
      throw new Error(
        'Comparator must be an expression-bodied (a, b) arrow function'
      );
    }

    const allowed = new Set([
      'a', 'b', 'undefined',
      ...Object.keys(schema)
    ]);

    function inspect(node: ts.Node): void {
      if (ts.isIdentifier(node)) {
        if (!allowed.has(node.text)) {
          throw new Error(`Forbidden identifier: ${node.text}`);
        }
      }

      if (ts.isPropertyAccessExpression(node)) {
        const property = node.name.text;

        const isField =
          ts.isIdentifier(node.expression) &&
          ['a', 'b'].includes(node.expression.text) &&
          Object.hasOwn(schema, property);

        const isLocaleCompare = property === 'localeCompare';

        if (!isField && !isLocaleCompare) {
          throw new Error(`Forbidden property access: ${property}`);
        }
      }

      if (ts.isCallExpression(node)) {
        if (
          !ts.isPropertyAccessExpression(node.expression) ||
          node.expression.name.text !== 'localeCompare'
        ) {
          throw new Error('Only localeCompare calls are permitted');
        }
      }

      const permitted = new Set([
        ts.SyntaxKind.ArrowFunction,
        ts.SyntaxKind.Parameter,
        ts.SyntaxKind.BinaryExpression,
        ts.SyntaxKind.PropertyAccessExpression,
        ts.SyntaxKind.CallExpression,
        ts.SyntaxKind.Identifier,
        ts.SyntaxKind.NumericLiteral,
        ts.SyntaxKind.StringLiteral,
        ts.SyntaxKind.TrueKeyword,
        ts.SyntaxKind.FalseKeyword,
        ts.SyntaxKind.NullKeyword,
        ts.SyntaxKind.UndefinedKeyword,
        ts.SyntaxKind.ObjectLiteralExpression,
        ts.SyntaxKind.PropertyAssignment,
        ts.SyntaxKind.ShorthandPropertyAssignment,
        ts.SyntaxKind.CommaToken,
        ts.SyntaxKind.ParenthesizedExpression,
        ts.SyntaxKind.PrefixUnaryExpression,
        ts.SyntaxKind.ConditionalExpression,
        ts.SyntaxKind.Token
      ]);

      if (
        !permitted.has(node.kind) &&
        !ts.isSourceFile(node) &&
        !ts.isVariableStatement(node) &&
        !ts.isVariableDeclarationList(node) &&
        !ts.isVariableDeclaration(node)
      ) {
        throw new Error(
          `Forbidden JavaScript syntax: ${ts.SyntaxKind[node.kind]}`
        );
      }

      ts.forEachChild(node, inspect);
    }

    inspect(initializer);
  }

  return {
    name: 'ai-compile-time',
    enforce: 'pre',

    async configResolved(resolved) {
      root = resolved.root;

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
          const [items, instructionNode, schemaNode] = node.arguments;

          if (
            !items ||
            !instructionNode ||
            !ts.isStringLiteral(instructionNode) ||
            !schemaNode ||
            !ts.isObjectLiteralExpression(schemaNode)
          ) {
            throw new Error(
              `Invalid sortAi() invocation in ${id}`
            );
          }

          const schema: Record<string, string> = {};

          for (const property of schemaNode.properties) {
            if (
              !ts.isPropertyAssignment(property) ||
              !ts.isIdentifier(property.name) ||
              !ts.isStringLiteral(property.initializer)
            ) {
              throw new Error('Invalid sortAi schema');
            }

            schema[property.name.text] =
              property.initializer.text;
          }

          const comparator = await generateComparator(
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

      await visit(ast);

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

export default defineConfig({
  plugins: [aiCompiler()]
});
