import type { Expression } from 'typescript/unstable/ast';
import {
  TypeFlags,
  type Checker
} from 'typescript/unstable/sync';

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
    throw new Error(`${method}() items must be an array`);
  }

  const schema: Record<string, string> = {};

  for (const property of checker.getPropertiesOfType(itemType)) {
    const propertyName = property.name;
    const propertyType = checker.getTypeOfSymbolAtLocation(
      property,
      items
    );
    const nonNullableType = checker.getNonNullableType(propertyType);
    const variants = nonNullableType?.isUnionType()
      ? nonNullableType.getTypes()
      : [nonNullableType];
    const fieldTypes = variants.map((type) => {
      if (!type) return undefined;
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
    });
    const fieldType = fieldTypes[0];

    if (!fieldType || fieldTypes.some((type) => type !== fieldType)) {
      throw new Error(
        `Unsupported ${method}() field type for "${propertyName}": ${checker.typeToString(propertyType)}`
      );
    }

    schema[propertyName] = fieldType;
  }

  return schema;
}
