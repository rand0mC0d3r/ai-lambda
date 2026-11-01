import {
  SymbolFlags,
  TypeFlags,
  type Checker,
  type Type
} from 'typescript/unstable/sync';
import type { Expression, TypeNode } from 'typescript/unstable/ast';
import type {
  AIFunctionParameterSchema,
  ResultShape
} from '../aiFunctions.js';
import { AIPluginError } from '../errors.js';
import { translate } from '../translations/en.js';

function getSimpleType(type: Type): string | undefined {
  if (type.flags & TypeFlags.StringLike) return 'string';
  if (type.flags & TypeFlags.NumberLike) return 'number';
  if (type.flags & TypeFlags.BooleanLike) return 'boolean';
  if ([type.getSymbol(), type.getAliasSymbol()].some((s) => s?.name === 'Date')) {
    return 'date';
  }
  return undefined;
}

function getNumberIndexValueType(checker: Checker, type: Type): Type | undefined {
  return checker.getIndexInfosOfType(type).find(
    (index) => index.keyType.flags & TypeFlags.NumberLike
  )?.valueType;
}

function inferFields(
  checker: Checker,
  type: Type,
  location: Expression,
  method: string
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

// Returns undefined for scalar and array results, which are not shape-checked.
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
    fields: inferFields(checker, resultType, initialValue ?? items, method),
    optionalFields: properties
      .filter((property) => (property.flags & SymbolFlags.Optional) !== 0)
      .map((property) => property.name)
  };
}

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
