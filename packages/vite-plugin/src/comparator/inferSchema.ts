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

  if (
    type.getSymbol()?.name === 'Date' ||
    type.getAliasSymbol()?.name === 'Date'
  ) {
    return 'date';
  }

  return undefined;
}

function inferFields(
  checker: Checker,
  type: Type,
  location: Expression,
  method: string
): Record<string, string> {
  const schema: Record<string, string> = {};

  for (const property of checker.getPropertiesOfType(type)) {
    const propertyName = property.name;
    const propertyType = checker.getTypeOfSymbolAtLocation(
      property,
      location
    );
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
          propertyName,
          type: checker.typeToString(propertyType)
        })
      );
    }

    schema[propertyName] = fieldType;
  }

  return schema;
}

export function inferSchema(
  checker: Checker,
  items: Expression,
  method: string
): Record<string, string> {
  const itemsType = checker.getTypeAtLocation(items);
  const numberIndex = itemsType &&
    checker.getIndexInfosOfType(itemsType).find(
      (index) => index.keyType.flags & TypeFlags.NumberLike
    );
  const itemType = numberIndex?.valueType;

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
  const initialType = checker.getTypeAtLocation(
    explicitType ?? initialValue
  );

  if (!initialType) {
    throw new Error(translate('cannotInferInitialValueType', { method }));
  }

  const accumulatorType = checker.getNonNullableType(initialType);

  if (!accumulatorType) {
    throw new Error(translate('cannotInferInitialValueType', { method }));
  }

  const simpleType = getSimpleType(accumulatorType);

  if (simpleType) {
    return { kind: 'scalar', type: simpleType };
  }

  const numberIndex = checker.getIndexInfosOfType(accumulatorType).find(
    (index) => index.keyType.flags & TypeFlags.NumberLike
  );

  if (numberIndex) {
    const elementType = checker.getNonNullableType(numberIndex.valueType);

    if (!elementType) {
      throw new Error(translate('cannotInferArrayAccumulatorType', { method }));
    }

    const simpleElementType = getSimpleType(elementType);

    if (simpleElementType) {
      return { kind: 'array', elementType: simpleElementType };
    }

    const elementFields = inferFields(
      checker,
      elementType,
      initialValue,
      method
    );

    if (Object.keys(elementFields).length) {
      return {
        kind: 'array',
        elementType: 'object',
        elementFields
      };
    }

    throw new Error(
      translate('unsupportedArrayInitialValue', { method })
    );
  }

  const fields = inferFields(checker, accumulatorType, initialValue, method);

  if (!Object.keys(fields).length) {
    throw new Error(
      translate('unsupportedInitialValue', { method })
    );
  }

  return { kind: 'object', fields };
}
