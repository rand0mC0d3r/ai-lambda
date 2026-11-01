import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import type {
  AIFunctionParameterSchema,
  AIFunctionSpec
} from '../aiFunctions.js';
import type { Node } from 'typescript/unstable/ast';
import {
  isArrowFunction,
  isBlock,
  isBinaryExpression,
  isCallExpression,
  isConditionalExpression,
  isIdentifier,
  isParenthesizedExpression,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isShorthandPropertyAssignment,
  isSourceFile,
  isSpreadAssignment,
  isSpreadElement,
  isToken,
  isVariableDeclaration,
  isVariableDeclarationList,
  isVariableStatement,
  isPrefixUnaryExpression
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
  SyntaxKind.ArrayLiteralExpression,
  SyntaxKind.PropertyAssignment,
  SyntaxKind.ShorthandPropertyAssignment,
  SyntaxKind.SpreadAssignment,
  SyntaxKind.SpreadElement,
  SyntaxKind.CommaToken,
  SyntaxKind.ParenthesizedExpression,
  SyntaxKind.PrefixUnaryExpression,
  SyntaxKind.ConditionalExpression
]);

const numericMethods = new Set(['round', 'floor', 'ceil']);
const protectedProperties = new Set(['__proto__', 'prototype', 'constructor']);
const arithmeticOperators = new Set([
  SyntaxKind.PlusToken,
  SyntaxKind.MinusToken,
  SyntaxKind.AsteriskToken,
  SyntaxKind.AsteriskAsteriskToken,
  SyntaxKind.SlashToken,
  SyntaxKind.PercentToken
]);
const comparisonOperators = new Set([
  SyntaxKind.LessThanToken,
  SyntaxKind.LessThanEqualsToken,
  SyntaxKind.GreaterThanToken,
  SyntaxKind.GreaterThanEqualsToken,
  SyntaxKind.EqualsEqualsEqualsToken,
  SyntaxKind.ExclamationEqualsEqualsToken
]);

export async function validateAiFunction(
  code: string,
  schema: Record<string, string>,
  spec: AIFunctionSpec,
  api: API,
  parameterSchemas?: Record<string, AIFunctionParameterSchema>
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

    const fieldsByParameter = Object.fromEntries(
      spec.parameters.map((parameter) => [
        parameter,
        parameterSchemas
          ? parameterSchemas[parameter]?.kind === 'object'
            ? parameterSchemas[parameter].fields
            : {}
          : schema
      ])
    );
    const parameterKinds = Object.fromEntries(
      spec.parameters.map((parameter) => [
        parameter,
        parameterSchemas?.[parameter]?.kind ?? 'object'
      ])
    );
    const typesByParameter = Object.fromEntries(
      spec.parameters.map((parameter) => [
        parameter,
        parameterSchemas?.[parameter]?.kind === 'scalar'
          ? {}
          : parameterSchemas?.[parameter]?.kind === 'object'
            ? parameterSchemas[parameter].fields
            : parameterSchemas?.[parameter]?.kind === 'array'
              ? parameterSchemas[parameter].elementFields ?? {}
              : schema
      ])
    );
    const scalarTypes = Object.fromEntries(
      spec.parameters.map((parameter) => [
        parameter,
        parameterSchemas?.[parameter]?.kind === 'scalar'
          ? parameterSchemas[parameter].type
          : undefined
      ])
    );
    const allowed = new Set([...spec.parameters, 'undefined']);

    function isNumericExpression(node: Node): boolean {
      if (node.kind === SyntaxKind.NumericLiteral) return true;

      if (isIdentifier(node)) {
        return scalarTypes[node.text] === 'number';
      }

      if (isParenthesizedExpression(node)) {
        return isNumericExpression(node.expression);
      }

      if (isPropertyAccessExpression(node)) {
        return (
          isIdentifier(node.expression) &&
          typesByParameter[node.expression.text]?.[node.name.text] === 'number'
        );
      }

      if (isCallExpression(node) && isPropertyAccessExpression(node.expression)) {
        return (
          isIdentifier(node.expression.expression) &&
          node.expression.expression.text === 'Math' &&
          spec.globals?.includes('Math') === true &&
          numericMethods.has(node.expression.name.text) &&
          spec.allowedMethods.includes(node.expression.name.text)
        );
      }

      if (isPrefixUnaryExpression(node)) {
        return (
          (node.operator === SyntaxKind.PlusToken ||
            node.operator === SyntaxKind.MinusToken) &&
          isNumericExpression(node.operand)
        );
      }

      if (isBinaryExpression(node)) {
        return (
          arithmeticOperators.has(node.operatorToken.kind) &&
          isNumericExpression(node.left) &&
          isNumericExpression(node.right)
        );
      }

      if (isConditionalExpression(node)) {
        return (
          isNumericExpression(node.whenTrue) &&
          isNumericExpression(node.whenFalse)
        );
      }

      return false;
    }

    function isStringField(node: Node): boolean {
      return (
        isPropertyAccessExpression(node) &&
        isIdentifier(node.expression) &&
        typesByParameter[node.expression.text]?.[node.name.text] === 'string'
      );
    }

    function isAllowedCall(node: Node): boolean {
      if (!isCallExpression(node) || !isPropertyAccessExpression(node.expression)) {
        return false;
      }

      const { expression, name } = node.expression;

      if (node.questionDotToken || node.arguments.some(isSpreadElement)) {
        return false;
      }

      if (
        isIdentifier(expression) &&
        expression.text === 'Math' &&
        spec.globals?.includes('Math') === true
      ) {
        return numericMethods.has(name.text) &&
          spec.allowedMethods.includes(name.text);
      }

      return (
        (name.text === 'localeCompare' || name.text === 'includes') &&
        spec.allowedMethods.includes(name.text) &&
        isStringField(expression)
      );
    }

    function inspect(node: Node, parent?: Node): void {
      if (
        node.kind === SyntaxKind.ArrayLiteralExpression &&
        spec.kind !== 'reduce'
      ) {
        throw new Error('Array literals are only permitted in reduceAi reducers');
      }

      if (isPropertyAssignment(node)) {
        const name = node.name;

        if (
          !isIdentifier(name) &&
          name.kind !== SyntaxKind.StringLiteral &&
          name.kind !== SyntaxKind.NumericLiteral
        ) {
          throw new Error('Computed object properties are not permitted');
        }

        if (protectedProperties.has(name.text)) {
          throw new Error(`Forbidden object property: ${name.text}`);
        }

        inspect(node.initializer);
        return;
      }

      if (isShorthandPropertyAssignment(node)) {
        throw new Error('Shorthand object properties are not permitted');
      }

      if (isSpreadAssignment(node)) {
        if (
          !isIdentifier(node.expression) ||
          parameterKinds[node.expression.text] !== 'object'
        ) {
          throw new Error(
            'Object spread is only permitted on object parameters'
          );
        }
      }

      if (isSpreadElement(node)) {
        if (
          !isIdentifier(node.expression) ||
          parameterKinds[node.expression.text] !== 'array'
        ) {
          throw new Error('Array spread is only permitted on array parameters');
        }
      }

      if (isIdentifier(node) && !allowed.has(node.text)) {
        throw new Error(`Forbidden identifier: ${node.text}`);
      }

      if (
        node.kind === SyntaxKind.ThisKeyword ||
        node.kind === SyntaxKind.SuperKeyword
      ) {
        throw new Error('this and super are not permitted');
      }

      if (isPropertyAccessExpression(node)) {
        const property = node.name.text;
        const isCallTarget =
          parent !== undefined &&
          isCallExpression(parent) &&
          parent.expression === node;
        const isField =
          isIdentifier(node.expression) &&
          Object.hasOwn(
            fieldsByParameter[node.expression.text] ?? {},
            property
          );
        const isMathMethod =
          isCallTarget &&
          isIdentifier(node.expression) &&
          node.expression.text === 'Math' &&
          spec.globals?.includes('Math') === true &&
          numericMethods.has(property) &&
          spec.allowedMethods.includes(property);
        const isStringMethod =
          isCallTarget &&
          (property === 'localeCompare' || property === 'includes') &&
          spec.allowedMethods.includes(property) &&
          isStringField(node.expression);

        if (
          node.questionDotToken ||
          protectedProperties.has(property) ||
          (!isField && !isMathMethod && !isStringMethod)
        ) {
          throw new Error(`Forbidden property access: ${property}`);
        }

        if (isField) {
          inspect(node.expression, node);
        }

        return;
      }

      if (
        isCallExpression(node) &&
        !isAllowedCall(node)
      ) {
        throw new Error(
          `Only ${spec.allowedMethods.join(', ')} calls are permitted`
        );
      }

      if (isBinaryExpression(node)) {
        const operator = node.operatorToken.kind;

        if (
          arithmeticOperators.has(operator) &&
          (!isNumericExpression(node.left) || !isNumericExpression(node.right))
        ) {
          throw new Error('Arithmetic operators require numeric expressions');
        }

        if (
          operator === SyntaxKind.EqualsEqualsToken ||
          operator === SyntaxKind.ExclamationEqualsToken
        ) {
          throw new Error('Loose equality operators are not permitted');
        }

        if (
          !arithmeticOperators.has(operator) &&
          !comparisonOperators.has(operator) &&
          operator !== SyntaxKind.AmpersandAmpersandToken &&
          operator !== SyntaxKind.BarBarToken &&
          operator !== SyntaxKind.QuestionQuestionToken
        ) {
          throw new Error(
            `Forbidden JavaScript operator: ${SyntaxKind[operator]}`
          );
        }
      }

      if (
        isPrefixUnaryExpression(node) &&
        node.operator !== SyntaxKind.PlusToken &&
        node.operator !== SyntaxKind.MinusToken &&
        node.operator !== SyntaxKind.ExclamationToken
      ) {
        throw new Error(
          `Forbidden JavaScript operator: ${SyntaxKind[node.operator]}`
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

      node.forEachChild((child) => inspect(child, node));
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
