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
import type { ExpectedResult, ResultShape } from '../aiFunctions.js';
import { AIPluginError } from '../errors.js';
import { translate } from '../translations/en.js';
import type { Node } from 'typescript/unstable/ast';
import {
  isArrowFunction,
  isBlock,
  isBinaryExpression,
  isCallExpression,
  isConditionalExpression,
  isIdentifier,
  isObjectLiteralExpression,
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

/** Declares a parameter's kind and the field types that generated code may use. */
interface ParameterInfo {
  kind: AIFunctionParameterSchema['kind'];
  fields: Record<string, string>;
  types: Record<string, string>;
  scalarType?: string;
}

/** Compiler options for the temporary module, so nullable and optional types are enforced. */
const SEMANTIC_CHECK_TSCONFIG = {
  compilerOptions: {
    strict: true,
    noEmit: true,
    target: 'ES2022',
    lib: ['es2022'],
    types: []
  },
  files: [GENERATED_FUNCTION_FILE]
};

/**
 * Checks that generated code is a valid, allowed arrow function for the given call.
 *
 * @param code The generated source text.
 * @param schema Field names and types of the array element or argument.
 * @param spec Spec for the AI method.
 * @param api TypeScript API used to type-check the code.
 * @param parameterSchemas Schemas for extra parameters, when present.
 * @param expectedResult Declared parameter and result types, and the result key shape, when known.
 * @throws {AIPluginError} With code `invalid_generated` when the code fails validation.
 */
export async function validateAiFunction(
  code: string,
  schema: Record<string, string>,
  spec: AIFunctionSpec,
  api: API,
  parameterSchemas?: Record<string, AIFunctionParameterSchema>,
  expectedResult?: ExpectedResult
): Promise<void> {
  try {
    await checkGeneratedFunction(code, schema, spec, api, parameterSchemas, expectedResult);
  } catch (error) {
    if (error instanceof AIPluginError) throw error;

    throw new AIPluginError(
      error instanceof Error ? error.message : String(error),
      'invalid_generated',
      { cause: error }
    );
  }
}

/**
 * Returns the field types that the generated code's parameter may access.
 *
 * @param parameterSchema Schema for this parameter, or `undefined` for the default element.
 * @param schema Field types of the default element.
 * @returns A map from field name to type. Scalars have no fields.
 */
function parameterTypes(
  parameterSchema: AIFunctionParameterSchema | undefined,
  schema: Record<string, string>
): Record<string, string> {
  if (!parameterSchema) return schema;

  switch (parameterSchema.kind) {
    case 'scalar':
      return {};
    case 'object':
      return parameterSchema.fields;
    case 'array':
      return parameterSchema.elementFields ?? {};
  }
}

/**
 * Builds the contextual function type that the generated arrow is checked against.
 *
 * @param spec Spec for the AI method.
 * @param expectedResult Declared parameter and result types, when known.
 * @returns The function type text, or `undefined` when there is nothing to check.
 */
function contextualFunctionType(
  spec: AIFunctionSpec,
  expectedResult: ExpectedResult | undefined
): string | undefined {
  if (!expectedResult?.parameters && !expectedResult?.result) return undefined;

  const parameters = spec.parameters.map(
    (parameter) => `${parameter}: ${expectedResult.parameters?.[parameter] ?? 'any'}`
  );

  return `(${parameters.join(', ')}) => ${expectedResult.result ?? 'any'}`;
}

/**
 * Parses the generated code in a temporary module, type-checks it, and runs the AST
 * checks. The temporary directory is removed when the check finishes.
 *
 * @param code The generated source text.
 * @param schema Field names and types of the array element or argument.
 * @param spec Spec for the AI method.
 * @param api TypeScript API used to create the snapshot.
 * @param parameterSchemas Schemas for extra parameters, when present.
 * @param expectedResult Declared parameter and result types, and the result key shape, when known.
 * @throws {AIPluginError} With code `invalid_generated` when the code fails a check.
 */
async function checkGeneratedFunction(
  code: string,
  schema: Record<string, string>,
  spec: AIFunctionSpec,
  api: API,
  parameterSchemas?: Record<string, AIFunctionParameterSchema>,
  expectedResult?: ExpectedResult
): Promise<void> {
  const tempDir = await mkdtemp(
    path.join(tmpdir(), GENERATED_FUNCTION_TEMP_PREFIX)
  );
  const tempFile = path.join(tempDir, GENERATED_FUNCTION_FILE);
  const functionType = contextualFunctionType(spec, expectedResult);
  let snapshot: Snapshot | undefined;

  try {
    await writeFile(
      path.join(tempDir, 'tsconfig.json'),
      JSON.stringify(SEMANTIC_CHECK_TSCONFIG)
    );
    await writeFile(
      tempFile,
      `const ${GENERATED_FUNCTION_VARIABLE}${functionType ? `: ${functionType}` : ''} = ${code};`
    );
    snapshot = api.updateSnapshot({ openFiles: [tempFile] });

    const project = snapshot.getDefaultProjectForFile(tempFile);
    const source = project?.program.getSourceFile(tempFile);

    if (!project || !source) {
      throw new Error(translate('unableToParseGeneratedFunction'));
    }

    if (
      project.program
        .getSyntacticDiagnostics(tempFile)
        .some((diagnostic) => diagnostic.category === DiagnosticCategory.Error)
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

    const parameterInfo = new Map<string, ParameterInfo>(
      spec.parameters.map((parameter): [string, ParameterInfo] => {
        const parameterSchema = parameterSchemas?.[parameter];

        return [
          parameter,
          {
            kind: parameterSchema?.kind ?? 'object',
            fields: parameterSchemas
              ? parameterSchema?.kind === 'object' ? parameterSchema.fields : {}
              : schema,
            types: parameterTypes(parameterSchema, schema),
            scalarType: parameterSchema?.kind === 'scalar'
              ? parameterSchema.type
              : undefined
          }
        ];
      })
    );
    const allowed = new Set([...spec.parameters, 'undefined']);

    function isMathMethod(object: Node, name: string): boolean {
      return (
        isIdentifier(object) &&
        object.text === 'Math' &&
        spec.globals?.includes('Math') === true &&
        NUMERIC_METHODS.has(name) &&
        spec.allowedMethods.includes(name)
      );
    }

    function isStringField(node: Node): boolean {
      return (
        isPropertyAccessExpression(node) &&
        isIdentifier(node.expression) &&
        parameterInfo.get(node.expression.text)?.types[node.name.text] === 'string'
      );
    }

    function isStringMethod(object: Node, name: string): boolean {
      return (
        (name === 'localeCompare' || name === 'includes') &&
        spec.allowedMethods.includes(name) &&
        isStringField(object)
      );
    }

    function isNumericExpression(node: Node): boolean {
      if (node.kind === SyntaxKind.NumericLiteral) return true;

      if (isIdentifier(node)) {
        return parameterInfo.get(node.text)?.scalarType === 'number';
      }

      if (isParenthesizedExpression(node)) {
        return isNumericExpression(node.expression);
      }

      if (isPropertyAccessExpression(node)) {
        return (
          isIdentifier(node.expression) &&
          parameterInfo.get(node.expression.text)?.types[node.name.text] === 'number'
        );
      }

      if (isCallExpression(node) && isPropertyAccessExpression(node.expression)) {
        return isMathMethod(node.expression.expression, node.expression.name.text);
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

    function isAllowedCall(node: Node): boolean {
      if (!isCallExpression(node) || !isPropertyAccessExpression(node.expression)) {
        return false;
      }

      const { expression, name } = node.expression;

      if (node.questionDotToken || node.arguments.some(isSpreadElement)) {
        return false;
      }

      return isMathMethod(expression, name.text) || isStringMethod(expression, name.text);
    }

    function addParameterFields(name: string, provided: Set<string>): void {
      for (const field of Object.keys(parameterInfo.get(name)?.fields ?? {})) {
        provided.add(field);
      }
    }

    // Checks key names only. Value types are checked by the semantic diagnostics below.
    function checkResultShape(body: Node, shape: ResultShape): void {
      let expression = body;

      while (isParenthesizedExpression(expression)) {
        expression = expression.expression;
      }

      const provided = new Set<string>();

      if (
        isIdentifier(expression) &&
        parameterInfo.get(expression.text)?.kind === 'object'
      ) {
        addParameterFields(expression.text, provided);
      } else if (isObjectLiteralExpression(expression)) {
        for (const property of expression.properties) {
          if (isSpreadAssignment(property)) {
            if (isIdentifier(property.expression)) {
              addParameterFields(property.expression.text, provided);
            }
          } else if (isPropertyAssignment(property)) {
            const { name } = property;

            if (name.kind === SyntaxKind.ComputedPropertyName) {
              throw new Error(translate('computedPropertyNotAllowed'));
            }

            const key = name.text;

            if (!Object.hasOwn(shape.fields, key)) {
              throw new Error(translate('undeclaredResultField', { name: key }));
            }

            provided.add(key);
          }
        }
      } else {
        throw new Error(translate('resultNotObject'));
      }

      for (const field of Object.keys(shape.fields)) {
        if (!provided.has(field) && !shape.optionalFields.includes(field)) {
          throw new Error(translate('missingResultField', { name: field }));
        }
      }
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
          parameterInfo.get(node.expression.text)?.kind !== 'object'
        ) {
          throw new Error(
            translate('objectSpreadNotAllowed')
          );
        }
      }

      if (isSpreadElement(node)) {
        if (
          !isIdentifier(node.expression) ||
          parameterInfo.get(node.expression.text)?.kind !== 'array'
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
            parameterInfo.get(node.expression.text)?.fields ?? {},
            property
          );
        const isMath = isCallTarget && isMathMethod(node.expression, property);
        const isString = isCallTarget && isStringMethod(node.expression, property);

        if (
          node.questionDotToken ||
          PROTECTED_PROPERTIES.has(property) ||
          (!isField && !isMath && !isString)
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

    if (expectedResult?.shape) {
      checkResultShape(initializer.body, expectedResult.shape);
    }

    if (functionType) {
      const diagnostic = project.program
        .getSemanticDiagnostics(tempFile)
        .find((item) => item.category === DiagnosticCategory.Error);

      if (diagnostic) {
        throw new Error(translate('semanticTypeMismatch', {
          role: spec.role,
          detail: diagnostic.text
        }));
      }
    }
  } finally {
    try {
      snapshot?.dispose();
      if (snapshot) {
        api.updateSnapshot({ closeFiles: [tempFile] }).dispose();
      }
    } catch {
      // A failed snapshot release must not replace the validation result or error.
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}
