import ts from 'typescript';

export function validateComparator(
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
    'localeCompare', 'numeric', 'sensitivity',
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
