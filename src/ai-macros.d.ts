type AISortField =
  | 'string'
  | 'number'
  | 'date'
  | 'boolean';

declare function sortAi<T>(
  items: readonly T[],
  instruction: string,
  schema: {
    [K in keyof T]?: AISortField;
  }
): T[];
