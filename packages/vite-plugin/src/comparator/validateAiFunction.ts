import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import type { AIFunctionSpec } from '../aiFunctions.js';
import type { Node } from 'typescript/unstable/ast';
import {
  isArrowFunction,
  isBlock,
  isCallExpression,
  isIdentifier,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isSourceFile,
  isToken,
  isVariableDeclaration,
  isVariableDeclarationList,
  isVariableStatement
} from 'typescript/unstable/ast/is';
import {
  DiagnosticCategory,
  type API,
  type Snapshot
} from 'typescript/unstable/sync';
import { SyntaxKind } from 'typescript/unstable/ast';

const permittedSyntaxKinds = new Set([
  SyntaxKind.ArrowFunction,
  SyntaxKind.Parameter,
  SyntaxKind.BinaryExpression,
  SyntaxKind.PropertyAccessExpression,
  SyntaxKind.CallExpression,
  SyntaxKind.Identifier,
  SyntaxKind.NumericLiteral,
  SyntaxKind.StringLiteral,
  SyntaxKind.TrueKeyword,
  SyntaxKind.FalseKeyword,
  SyntaxKind.NullKeyword,
  SyntaxKind.UndefinedKeyword,
  SyntaxKind.ObjectLiteralExpression,
  SyntaxKind.PropertyAssignment,
  SyntaxKind.ShorthandPropertyAssignment,
  SyntaxKind.SpreadAssignment,
  SyntaxKind.CommaToken,
  SyntaxKind.ParenthesizedExpression,
  SyntaxKind.PrefixUnaryExpression,
  SyntaxKind.ConditionalExpression,
]);

export async function validateAiFunction(
  code: string,
  schema: Record<string, string>,
  spec: AIFunctionSpec,
  api: API
): Promise<void> {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'ai-lambda-'));
  const tempFile = path.join(tempDir, 'generated.ts');
  let snapshot: Snapshot | undefined;

  try {
    await writeFile(tempFile, `const __generated = ${code};`);
    snapshot = api.updateSnapshot({ openFiles: [tempFile] });

    const project = snapshot.getDefaultProjectForFile(tempFile);
    const source = project?.program.getSourceFile(tempFile);

    if (!project || !source) {
      throw new Error('Unable to parse generated JavaScript function');
    }

    const diagnostics = project.program.getSyntacticDiagnostics(tempFile);

    if (
      diagnostics.some(
        (diagnostic) => diagnostic.category === DiagnosticCategory.Error
      )
    ) {
      throw new Error('Invalid generated JavaScript syntax');
    }

    const declaration = source.statements[0];

    if (!isVariableStatement(declaration)) {
      throw new Error('Invalid generated function declaration');
    }

    const initializer =
      declaration.declarationList.declarations[0]?.initializer;

    if (
      !initializer ||
      !isArrowFunction(initializer) ||
      initializer.parameters.length !== spec.parameters.length ||
      initializer.parameters.some(
        (parameter, index) =>
          !isIdentifier(parameter.name) ||
          parameter.name.text !== spec.parameters[index]
      ) ||
      isBlock(initializer.body)
    ) {
      throw new Error(
        `Generated function must be an expression-bodied (${spec.parameters.join(', ')}) arrow function`
      );
    }

    const allowed = new Set([
      ...spec.parameters,
      ...(spec.globals ?? []),
      'undefined',
      'numeric',
      'sensitivity',
      ...spec.allowedMethods,
      ...Object.keys(schema)
    ]);

    function inspect(node: Node): void {
      if (isPropertyAssignment(node)) {
        inspect(node.initializer);
        return;
      }

      if (isIdentifier(node) && !allowed.has(node.text)) {
        throw new Error(`Forbidden identifier: ${node.text}`);
      }

      if (isPropertyAccessExpression(node)) {
        const property = node.name.text;
        const isField =
          isIdentifier(node.expression) &&
          spec.parameters.includes(node.expression.text) &&
          Object.hasOwn(schema, property);
        const isAllowedMethod = spec.allowedMethods.includes(property);

        if (!isField && !isAllowedMethod) {
          throw new Error(`Forbidden property access: ${property}`);
        }
      }

      if (
        isCallExpression(node) &&
        (!isPropertyAccessExpression(node.expression) ||
          !spec.allowedMethods.includes(node.expression.name.text))
      ) {
        throw new Error(
          `Only ${spec.allowedMethods.join(', ')} calls are permitted`
        );
      }

      if (
        !permittedSyntaxKinds.has(node.kind) &&
        !isToken(node) &&
        !isSourceFile(node) &&
        !isVariableStatement(node) &&
        !isVariableDeclarationList(node) &&
        !isVariableDeclaration(node)
      ) {
        throw new Error(
          `Forbidden JavaScript syntax: ${SyntaxKind[node.kind]}`
        );
      }

      node.forEachChild(inspect);
    }

    inspect(initializer);
  } finally {
    snapshot?.dispose();
    if (snapshot) {
      const closeSnapshot = api.updateSnapshot({ closeFiles: [tempFile] });
      closeSnapshot.dispose();
    }
    await rm(tempDir, { recursive: true, force: true });
  }
}
