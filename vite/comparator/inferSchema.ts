import ts from 'typescript';

export function inferSchema(
  checker: ts.TypeChecker,
  items: ts.Expression
): Record<string, string> {
  const itemsType = checker.getTypeAtLocation(items);
  const itemType = checker.getElementTypeOfArrayType(itemsType);

  if (!itemType) {
    throw new Error('sortAi() items must be an array');
  }

  const schema: Record<string, string> = {};

  for (const property of checker.getPropertiesOfType(itemType)) {
    const propertyName = property.getName();
    const propertyType = checker.getTypeOfSymbolAtLocation(
      property,
      items
    );
    const nonNullableType = checker.getNonNullableType(propertyType);
    const variants = nonNullableType.isUnion()
      ? nonNullableType.types
      : [nonNullableType];
    const fieldTypes = variants.map((type) => {
      if (type.flags & ts.TypeFlags.StringLike) return 'string';
      if (type.flags & ts.TypeFlags.NumberLike) return 'number';
      if (type.flags & ts.TypeFlags.BooleanLike) return 'boolean';

      if (
        type.getSymbol()?.name === 'Date' ||
        type.aliasSymbol?.name === 'Date'
      ) {
        return 'date';
      }

      return undefined;
    });
    const fieldType = fieldTypes[0];

    if (!fieldType || fieldTypes.some((type) => type !== fieldType)) {
      throw new Error(
        `Unsupported sortAi() field type for "${propertyName}": ${checker.typeToString(propertyType)}`
      );
    }

    schema[propertyName] = fieldType;
  }

  return schema;
}
