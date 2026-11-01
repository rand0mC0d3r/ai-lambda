import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import type {
  AIFunctionParameterSchema,
  AIFunctionSpec
} from '../aiFunctions.js';
import {
  ARITHMETIC_OPERATORS,
  COMPARISON_OPERATORS,
  GENERATED_FUNCTION_FILE,
  GENERATED_FUNCTION_TEMP_PREFIX,
  GENERATED_FUNCTION_VARIABLE,
  NUMERIC_METHODS,
  PERMITTED_SYNTAX_KINDS,
  PROTECTED_PROPERTIES
} from '../constants.js';
import { translate } from '../translations/en.js';
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

export async function validateAiFunction(
  code: string,
  schema: Record<string, string>,
  spec: AIFunctionSpec,
  api: API,
  parameterSchemas?: Record<string, AIFunctionParameterSchema>
): Promise<void> {
  const tempDir = await mkdtemp(
    path.join(tmpdir(), GENERATED_FUNCTION_TEMP_PREFIX)
  );
  const tempFile = path.join(tempDir, GENERATED_FUNCTION_FILE);
  let snapshot: Snapshot | undefined;

  try {
    await writeFile(
      tempFile,
      `const ${GENERATED_FUNCTION_VARIABLE} = ${code};`
    );
    snapshot = api.updateSnapshot({ openFiles: [tempFile] });

    const project = snapshot.getDefaultProjectForFile(tempFile);
    const source = project?.program.getSourceFile(tempFile);

    if (!project || !source) {
      throw new Error(translate('unableToParseGeneratedFunction'));
    }

    const diagnostics = project.program.getSyntacticDiagnostics(tempFile);

    if (
      diagnostics.some(
        (diagnostic) => diagnostic.category === DiagnosticCategory.Error
      )
    ) {
      throw new Error(translate('invalidGeneratedSyntax'));
    }

    const declaration = source.statements[0];

    if (!isVariableStatement(declaration)) {
      throw new Error(translate('invalidGeneratedDeclaration'));
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
        translate('invalidArrowFunction', {
          parameters: spec.parameters.join(', ')
        })
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
          NUMERIC_METHODS.has(node.expression.name.text) &&
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
          ARITHMETIC_OPERATORS.has(node.operatorToken.kind) &&
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
        return NUMERIC_METHODS.has(name.text) &&
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
        throw new Error(translate('arrayLiteralNotAllowed'));
      }

      if (isPropertyAssignment(node)) {
        const name = node.name;

        if (
          !isIdentifier(name) &&
          name.kind !== SyntaxKind.StringLiteral &&
          name.kind !== SyntaxKind.NumericLiteral
        ) {
          throw new Error(translate('computedPropertyNotAllowed'));
        }

        if (PROTECTED_PROPERTIES.has(name.text)) {
          throw new Error(translate('forbiddenObjectProperty', {
            name: name.text
          }));
        }

        inspect(node.initializer);
        return;
      }

      if (isShorthandPropertyAssignment(node)) {
        throw new Error(translate('shorthandPropertyNotAllowed'));
      }

      if (isSpreadAssignment(node)) {
        if (
          !isIdentifier(node.expression) ||
          parameterKinds[node.expression.text] !== 'object'
        ) {
          throw new Error(
            translate('objectSpreadNotAllowed')
          );
        }
      }

      if (isSpreadElement(node)) {
        if (
          !isIdentifier(node.expression) ||
          parameterKinds[node.expression.text] !== 'array'
        ) {
          throw new Error(translate('arraySpreadNotAllowed'));
        }
      }

      if (isIdentifier(node) && !allowed.has(node.text)) {
        throw new Error(translate('forbiddenIdentifier', {
          name: node.text
        }));
      }

      if (
        node.kind === SyntaxKind.ThisKeyword ||
        node.kind === SyntaxKind.SuperKeyword
      ) {
        throw new Error(translate('thisAndSuperNotAllowed'));
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
          NUMERIC_METHODS.has(property) &&
          spec.allowedMethods.includes(property);
        const isStringMethod =
          isCallTarget &&
          (property === 'localeCompare' || property === 'includes') &&
          spec.allowedMethods.includes(property) &&
          isStringField(node.expression);

        if (
          node.questionDotToken ||
          PROTECTED_PROPERTIES.has(property) ||
          (!isField && !isMathMethod && !isStringMethod)
        ) {
          throw new Error(translate('forbiddenPropertyAccess', { property }));
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
          translate('onlyAllowedCalls', {
            methods: spec.allowedMethods.join(', ')
          })
        );
      }

      if (isBinaryExpression(node)) {
        const operator = node.operatorToken.kind;

        if (
          ARITHMETIC_OPERATORS.has(operator) &&
          (!isNumericExpression(node.left) || !isNumericExpression(node.right))
        ) {
          throw new Error(translate('arithmeticRequiresNumbers'));
        }

        if (
          operator === SyntaxKind.EqualsEqualsToken ||
          operator === SyntaxKind.ExclamationEqualsToken
        ) {
          throw new Error(translate('looseEqualityNotAllowed'));
        }

        if (
          !ARITHMETIC_OPERATORS.has(operator) &&
          !COMPARISON_OPERATORS.has(operator) &&
          operator !== SyntaxKind.AmpersandAmpersandToken &&
          operator !== SyntaxKind.BarBarToken &&
          operator !== SyntaxKind.QuestionQuestionToken
        ) {
          throw new Error(
            translate('forbiddenOperator', {
              operator: SyntaxKind[operator]
            })
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
          translate('forbiddenOperator', {
            operator: SyntaxKind[node.operator]
          })
        );
      }

      if (
        !PERMITTED_SYNTAX_KINDS.has(node.kind) &&
        !isToken(node) &&
        !isSourceFile(node) &&
        !isVariableStatement(node) &&
        !isVariableDeclarationList(node) &&
        !isVariableDeclaration(node)
      ) {
        throw new Error(
          translate('forbiddenSyntax', {
            syntax: SyntaxKind[node.kind]
          })
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
