import {
  TypeFlags,
  type Checker,
  type Type
} from 'typescript/unstable/sync';
import type { Expression, TypeNode } from 'typescript/unstable/ast';
import type { AIFunctionParameterSchema } from '../aiFunctions.js';
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
      throw new Error(
        translate('unsupportedFieldType', {
          method,
          propertyName: property.name,
          type: checker.typeToString(propertyType)
        })
      );
    }

    schema[property.name] = fieldType;
  }

  return schema;
}

export function inferSchema(
  checker: Checker,
  items: Expression,
  method: string
): Record<string, string> {
  const itemsType = checker.getTypeAtLocation(items);
  const itemType = itemsType && getNumberIndexValueType(checker, itemsType);

  if (!itemType) {
    throw new Error(translate('itemsMustBeArray', { method }));
  }

  return inferFields(checker, itemType, items, method);
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
    throw new Error(translate('cannotInferInitialValueType', { method }));
  }

  const simpleType = getSimpleType(accumulatorType);

  if (simpleType) {
    return { kind: 'scalar', type: simpleType };
  }

  const numberIndexValueType = getNumberIndexValueType(checker, accumulatorType);

  if (numberIndexValueType) {
    const elementType = checker.getNonNullableType(numberIndexValueType);

    if (!elementType) {
      throw new Error(translate('cannotInferArrayAccumulatorType', { method }));
    }

    const simpleElementType = getSimpleType(elementType);

    if (simpleElementType) {
      return { kind: 'array', elementType: simpleElementType };
    }

    const elementFields = inferFields(checker, elementType, initialValue, method);

    if (!Object.keys(elementFields).length) {
      throw new Error(translate('unsupportedArrayInitialValue', { method }));
    }

    return { kind: 'array', elementType: 'object', elementFields };
  }

  const fields = inferFields(checker, accumulatorType, initialValue, method);

  if (!Object.keys(fields).length) {
    throw new Error(translate('unsupportedInitialValue', { method }));
  }

  return { kind: 'object', fields };
}
