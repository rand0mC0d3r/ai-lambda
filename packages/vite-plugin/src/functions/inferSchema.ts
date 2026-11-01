import {
  SignatureKind,
  SymbolFlags,
  TypeFlags,
  type Checker,
  type Type
} from 'typescript/unstable/sync';
import type { Expression, TypeNode } from 'typescript/unstable/ast';
import type {
  AIFunctionParameterSchema,
  AIFunctionSpec,
  ExpectedResult,
  ResultShape
} from '../aiFunctions.js';
import { AIPluginError } from '../errors.js';
import { translate } from '../translations/en.js';

/** Nesting limit for rendered types, which also stops recursive types. */
const MAX_TYPE_DEPTH = 8;

const IDENTIFIER_PATTERN = /^[A-Za-z_$][\w$]*$/;

/** Methods whose callback must return a boolean. */
const PREDICATE_KINDS = new Set<AIFunctionSpec['kind']>(['filter', 'find', 'some']);

/**
 * Maps a TypeScript type to the simple type name used in generated code.
 *
 * @param type The type to map.
 * @returns `string`, `number`, `boolean`, `date`, or `undefined` when unsupported.
 */
function getSimpleType(type: Type): string | undefined {
  if (type.flags & TypeFlags.StringLike) return 'string';
  if (type.flags & TypeFlags.NumberLike) return 'number';
  if (type.flags & TypeFlags.BooleanLike) return 'boolean';
  if ([type.getSymbol(), type.getAliasSymbol()].some((s) => s?.name === 'Date')) {
    return 'date';
  }
  return undefined;
}

/**
 * Returns the value type of a numeric index signature, such as the element type of an array.
 *
 * @param checker The TypeScript type checker.
 * @param type The type to inspect.
 * @returns The value type, or `undefined` when the type has no numeric index.
 */
function getNumberIndexValueType(checker: Checker, type: Type): Type | undefined {
  return checker.getIndexInfosOfType(type).find(
    (index) => index.keyType.flags & TypeFlags.NumberLike
  )?.valueType;
}

/**
 * Maps each property of an object type to its simple type name.
 *
 * @param checker The TypeScript type checker.
 * @param type The object type whose properties are inspected.
 * @param location The expression used to resolve property types.
 * @param method The source method name, used in error messages.
 * @param allowNested When true, properties that are not simple types are recorded as `object`
 *   instead of failing. Used for result shapes, which check only key names.
 * @returns A map from property name to simple type.
 * @throws {AIPluginError} With code `unsupported_type` when a property has an unsupported type.
 */
function inferFields(
  checker: Checker,
  type: Type,
  location: Expression,
  method: string,
  allowNested = false
): Record<string, string> {
  const schema: Record<string, string> = {};

  for (const property of checker.getPropertiesOfType(type)) {
    const propertyType = checker.getTypeOfSymbolAtLocation(property, location);
    const nonNullableType = checker.getNonNullableType(propertyType);
    const variants = nonNullableType?.isUnionType()
      ? nonNullableType.getTypes()
      : [nonNullableType];
    const fieldTypes = variants.map((variant) =>
      variant ? getSimpleType(variant) : undefined
    );
    const fieldType = fieldTypes[0];

    if (!fieldType || fieldTypes.some((variant) => variant !== fieldType)) {
      if (allowNested) {
        schema[property.name] = 'object';
        continue;
      }

      throw new AIPluginError(
        translate('unsupportedFieldType', {
          method,
          propertyName: property.name,
          type: checker.typeToString(propertyType)
        }),
        'unsupported_type'
      );
    }

    schema[property.name] = fieldType;
  }

  return schema;
}

/**
 * Returns the item type of the array passed to an AI method.
 *
 * @param checker The TypeScript type checker.
 * @param items The array expression.
 * @param method The source method name, used in error messages.
 * @returns The element type.
 * @throws {AIPluginError} With code `unsupported_type` when the expression is not an array.
 */
function getItemType(
  checker: Checker,
  items: Expression,
  method: string
): Type {
  const itemsType = checker.getTypeAtLocation(items);
  const itemType = itemsType && getNumberIndexValueType(checker, itemsType);

  if (!itemType) {
    throw new AIPluginError(translate('itemsMustBeArray', { method }), 'unsupported_type');
  }

  return itemType;
}

/**
 * Infers the field schema of the array elements for an AI method.
 *
 * @param checker The TypeScript type checker.
 * @param items The array expression.
 * @param method The source method name.
 * @returns A map from field name to simple type.
 */
export function inferSchema(
  checker: Checker,
  items: Expression,
  method: string
): Record<string, string> {
  return inferFields(
    checker,
    getItemType(checker, items, method),
    items,
    method
  );
}

/**
 * Infers the shape of the result of a `mapAi` or `reduceAi` call.
 * The shape is used to check that generated code returns every declared field.
 *
 * @param checker The TypeScript type checker.
 * @param items The array expression.
 * @param method The source method name.
 * @param initialValue The `reduceAi` initial value, if any.
 * @param explicitType The explicit type argument, if any.
 * @returns The result shape, or `undefined` for scalar and array results, which are not shape-checked.
 */
export function inferResultShape(
  checker: Checker,
  items: Expression,
  method: string,
  initialValue?: Expression,
  explicitType?: TypeNode
): ResultShape | undefined {
  const locatedType = initialValue
    ? checker.getTypeAtLocation(explicitType ?? initialValue)
    : explicitType
      ? checker.getTypeAtLocation(explicitType)
      : getItemType(checker, items, method);
  const resultType = locatedType && checker.getNonNullableType(locatedType);

  if (
    !resultType ||
    getSimpleType(resultType) ||
    getNumberIndexValueType(checker, resultType)
  ) {
    return undefined;
  }

  const properties = checker.getPropertiesOfType(resultType);

  if (!properties.length) return undefined;

  return {
    fields: inferFields(checker, resultType, initialValue ?? items, method, true),
    optionalFields: properties
      .filter((property) => (property.flags & SymbolFlags.Optional) !== 0)
      .map((property) => property.name)
  };
}

/**
 * Renders a checker type as TypeScript source text for the semantic check.
 * Literal types are widened. Parameter types drop `null` and `undefined`, since the
 * prompt schema does not record nullability. Result types keep them.
 *
 * @param checker The TypeScript type checker.
 * @param type The type to render.
 * @param location The expression used to resolve property types.
 * @param mode Whether the text types a parameter or the declared result.
 * @param depth The current nesting depth.
 * @returns The source text, or `undefined` when the type cannot be expressed faithfully.
 */
function typeSource(
  checker: Checker,
  type: Type,
  location: Expression,
  mode: 'parameter' | 'result',
  depth = 0
): string | undefined {
  if (depth > MAX_TYPE_DEPTH) return undefined;

  const parts = new Set<string>();

  for (const variant of type.isUnionType() ? type.getTypes() : [type]) {
    if (
      mode === 'parameter' &&
      variant.flags & (TypeFlags.Null | TypeFlags.Undefined)
    ) {
      continue;
    }

    const part = singleTypeSource(checker, variant, location, mode, depth);

    if (part === undefined) return undefined;

    parts.add(part);
  }

  return parts.size ? [...parts].join(' | ') : undefined;
}

/**
 * Renders a non-union type as TypeScript source text. See {@link typeSource}.
 *
 * @param checker The TypeScript type checker.
 * @param type The non-union type to render.
 * @param location The expression used to resolve property types.
 * @param mode Whether the text types a parameter or the declared result.
 * @param depth The current nesting depth.
 * @returns The source text, or `undefined` when the type cannot be expressed faithfully.
 */
function singleTypeSource(
  checker: Checker,
  type: Type,
  location: Expression,
  mode: 'parameter' | 'result',
  depth: number
): string | undefined {
  const { flags } = type;

  if (flags & TypeFlags.Any) return 'any';
  if (flags & TypeFlags.Unknown) return 'unknown';
  if (flags & TypeFlags.Null) return 'null';
  if (flags & TypeFlags.Undefined) return 'undefined';
  if (flags & TypeFlags.StringLike) return 'string';
  if (flags & TypeFlags.NumberLike) return 'number';
  if (flags & (TypeFlags.BigInt | TypeFlags.BigIntLiteral)) return 'bigint';
  if (flags & TypeFlags.BooleanLike) return 'boolean';
  if (flags & TypeFlags.NonPrimitive) return 'object';

  if (!(flags & TypeFlags.Object)) return undefined;

  if (type.getSymbol()?.name === 'Date') return 'Date';

  if (checker.isArrayType(type)) {
    const elementType = getNumberIndexValueType(checker, type);
    const elementSource = elementType &&
      typeSource(checker, elementType, location, mode, depth + 1);

    return elementSource === undefined ? undefined : `(${elementSource})[]`;
  }

  // Functions and index signatures cannot be rendered as plain object literal types.
  if (
    checker.getSignaturesOfType(type, SignatureKind.Call).length ||
    checker.getIndexInfosOfType(type).length
  ) {
    return undefined;
  }

  const members: string[] = [];

  for (const property of checker.getPropertiesOfType(type)) {
    const propertySource = typeSource(
      checker,
      checker.getTypeOfSymbolAtLocation(property, location),
      location,
      mode,
      depth + 1
    );

    if (propertySource === undefined) return undefined;

    const name = IDENTIFIER_PATTERN.test(property.name)
      ? property.name
      : JSON.stringify(property.name);
    // Parameters omit `?` so they match the schema given to the model, which has no optional fields.
    const optional = mode === 'result' && (property.flags & SymbolFlags.Optional) !== 0
      ? '?'
      : '';

    members.push(`${name}${optional}: ${propertySource};`);
  }

  return `{ ${members.join(' ')} }`;
}

/**
 * Builds the type information used to check generated code: the parameter types,
 * the declared result type, and the result key shape for `mapAi` and `reduceAi`.
 *
 * @param checker The TypeScript type checker.
 * @param items The array expression.
 * @param spec The AI method spec.
 * @param initialValue The `reduceAi` initial value, if any.
 * @param explicitType The explicit type argument, if any.
 * @returns The expected result. Parts that cannot be expressed are omitted.
 */
export function inferExpectedResult(
  checker: Checker,
  items: Expression,
  spec: AIFunctionSpec,
  initialValue?: Expression,
  explicitType?: TypeNode
): ExpectedResult {
  const itemType = getItemType(checker, items, spec.method);
  const accumulatorType = spec.kind === 'reduce' && initialValue
    ? checker.getTypeAtLocation(explicitType ?? initialValue)
    : undefined;
  const itemSource = typeSource(checker, itemType, items, 'parameter');
  const accumulatorSource = accumulatorType &&
    typeSource(checker, accumulatorType, items, 'parameter');
  const declaredType = explicitType
    ? checker.getTypeAtLocation(explicitType)
    : accumulatorType;
  const resultSource = spec.kind === 'sort'
    ? 'number'
    : PREDICATE_KINDS.has(spec.kind)
      ? 'boolean'
      : declaredType && typeSource(checker, declaredType, items, 'result');
  const parameters: Record<string, string> = {};

  spec.parameters.forEach((parameter, index) => {
    const source = spec.kind === 'reduce' && index === 0
      ? accumulatorSource
      : itemSource;

    if (source) parameters[parameter] = source;
  });

  const shape = spec.kind === 'map' || spec.kind === 'reduce'
    ? inferResultShape(checker, items, spec.method, initialValue, explicitType)
    : undefined;

  return {
    ...(shape ? { shape } : {}),
    parameters,
    ...(resultSource ? { result: resultSource } : {})
  };
}

/**
 * Infers the type of a `reduceAi` accumulator from its initial value.
 *
 * @param checker The TypeScript type checker.
 * @param initialValue The initial value expression.
 * @param method The source method name, used in error messages.
 * @param explicitType The explicit type argument, if any.
 * @returns A scalar, array, or object parameter schema.
 * @throws {AIPluginError} With code `unsupported_type` when the type cannot be described.
 */
export function inferAccumulatorSchema(
  checker: Checker,
  initialValue: Expression,
  method: string,
  explicitType?: TypeNode
): AIFunctionParameterSchema {
  const initialType = checker.getTypeAtLocation(explicitType ?? initialValue);
  const accumulatorType =
    initialType && checker.getNonNullableType(initialType);

  if (!accumulatorType) {
    throw new AIPluginError(translate('cannotInferInitialValueType', { method }), 'unsupported_type');
  }

  const simpleType = getSimpleType(accumulatorType);

  if (simpleType) {
    return { kind: 'scalar', type: simpleType };
  }

  const numberIndexValueType = getNumberIndexValueType(checker, accumulatorType);

  if (numberIndexValueType) {
    const elementType = checker.getNonNullableType(numberIndexValueType);

    if (!elementType) {
      throw new AIPluginError(translate('cannotInferArrayAccumulatorType', { method }), 'unsupported_type');
    }

    const simpleElementType = getSimpleType(elementType);

    if (simpleElementType) {
      return { kind: 'array', elementType: simpleElementType };
    }

    const elementFields = inferFields(checker, elementType, initialValue, method);

    if (!Object.keys(elementFields).length) {
      throw new AIPluginError(translate('unsupportedArrayInitialValue', { method }), 'unsupported_type');
    }

    return { kind: 'array', elementType: 'object', elementFields };
  }

  const fields = inferFields(checker, accumulatorType, initialValue, method);

  if (!Object.keys(fields).length) {
    throw new AIPluginError(translate('unsupportedInitialValue', { method }), 'unsupported_type');
  }

  return { kind: 'object', fields };
}
