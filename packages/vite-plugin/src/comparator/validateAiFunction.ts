import ts from 'typescript';
import type { AIFunctionSpec } from '../aiFunctions.js';

export function validateAiFunction(
  code: string,
  schema: Record<string, string>,
  spec: AIFunctionSpec
) {
  const source = ts.createSourceFile(
    'generated.ts',
    `const __generated = ${code};`,
    ts.ScriptTarget.ESNext,
    true
  );
  const diagnostics =
    ts.transpileModule(source.text, {
      reportDiagnostics: true
    }).diagnostics ?? [];

  if (
    diagnostics.some(
      (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error
    )
  ) {
    throw new Error('Invalid generated JavaScript syntax');
  }

  const declaration = source.statements[0];

  if (!ts.isVariableStatement(declaration)) {
    throw new Error('Invalid generated function declaration');
  }

  const initializer =
    declaration.declarationList.declarations[0]?.initializer;

  if (
    !initializer ||
    !ts.isArrowFunction(initializer) ||
    initializer.parameters.length !== spec.parameters.length ||
    initializer.parameters.some(
      (parameter, index) =>
        !ts.isIdentifier(parameter.name) ||
        parameter.name.text !== spec.parameters[index]
    ) ||
    ts.isBlock(initializer.body)
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

  function inspect(node: ts.Node): void {
    // Output keys of an object literal are names, not references.
    if (ts.isPropertyAssignment(node)) {
      inspect(node.initializer);
      return;
    }

    if (ts.isIdentifier(node)) {
      if (!allowed.has(node.text)) {
        throw new Error(`Forbidden identifier: ${node.text}`);
      }
    }

    if (ts.isPropertyAccessExpression(node)) {
      const property = node.name.text;

      const isField =
        ts.isIdentifier(node.expression) &&
        spec.parameters.includes(node.expression.text) &&
        Object.hasOwn(schema, property);

      const isAllowedMethod = spec.allowedMethods.includes(property);

      if (!isField && !isAllowedMethod) {
        throw new Error(`Forbidden property access: ${property}`);
      }
    }

    if (ts.isCallExpression(node)) {
      if (
        !ts.isPropertyAccessExpression(node.expression) ||
        !spec.allowedMethods.includes(node.expression.name.text)
      ) {
        throw new Error(
          `Only ${spec.allowedMethods.join(', ')} calls are permitted`
        );
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
      ts.SyntaxKind.SpreadAssignment,
      ts.SyntaxKind.CommaToken,
      ts.SyntaxKind.ParenthesizedExpression,
      ts.SyntaxKind.PrefixUnaryExpression,
      ts.SyntaxKind.ConditionalExpression,
    ]);

    if (
      !permitted.has(node.kind) &&
      !ts.isToken(node) &&
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
