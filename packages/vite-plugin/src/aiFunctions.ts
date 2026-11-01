export interface AIFunctionSpec {
  kind: 'sort' | 'filter' | 'map' | 'reduce';
  method: string;
  replacementMethod: 'toSorted' | 'filter' | 'map' | 'reduce';
  outputField: string;
  schemaName: string;
  role: string;
  signature: string;
  parameters: readonly string[];
  globals?: readonly string[];
  allowedMethods: readonly string[];
  rules: readonly string[];
}

export type AIFunctionParameterSchema =
  | {
    kind: 'scalar';
    type: string;
  }
  | {
    kind: 'object';
    fields: Record<string, string>;
  }
  | {
    kind: 'array';
    elementType: string;
    elementFields?: Record<string, string>;
  };

export const aiFunctionSpecs: Record<string, AIFunctionSpec> = {
  sortAi: {
    kind: 'sort',
    method: 'sortAi',
    replacementMethod: 'toSorted',
    outputField: 'comparator',
    schemaName: 'sort_comparator',
    role: 'comparator',
    signature: '(a, b) => ...',
    parameters: ['a', 'b'],
    allowedMethods: ['localeCompare'],
    rules: [
      'Return a negative number when a comes first.',
      'Return zero when equivalent.',
      'Return a positive number when b comes first.',
      'Only access fields defined in the supplied schema.',
      'Use arithmetic for numeric comparisons.',
      'Use localeCompare with numeric:true and sensitivity:"base" for natural string sorting.',
      'No external dependencies.',
      'No mutations.',
      'No additional variables or statements.'
    ]
  },
  filterAi: {
    kind: 'filter',
    method: 'filterAi',
    replacementMethod: 'filter',
    outputField: 'predicate',
    schemaName: 'filter_predicate',
    role: 'predicate',
    signature: '(item) => ...',
    parameters: ['item'],
    allowedMethods: ['localeCompare', 'includes'],
    rules: [
      'Return true when the item should be kept.',
      'Return false when the item should be removed.',
      'Only access fields defined in the supplied schema.',
      'Use comparison operators for numeric, boolean and date comparisons.',
      'Use includes or localeCompare with sensitivity:"base" for case-insensitive string matching.',
      'No external dependencies.',
      'No mutations.',
      'No additional variables or statements.'
    ]
  },
  mapAi: {
    kind: 'map',
    method: 'mapAi',
    replacementMethod: 'map',
    outputField: 'mapper',
    schemaName: 'map_mapper',
    role: 'mapper',
    signature: '(item) => ...',
    parameters: ['item'],
    globals: ['Math'],
    allowedMethods: ['localeCompare', 'includes', 'round', 'floor', 'ceil'],
    rules: [
      'Return the transformed item as an object literal.',
      'Use the spread operator to keep unchanged fields, for example ({...item, unitPrice: value}).',
      'Only access fields defined in the supplied schema.',
      'Use arithmetic for numeric changes and Math.round, Math.floor or Math.ceil for rounding.',
      'Use includes or localeCompare for string checks.',
      'No external dependencies.',
      'No mutations.',
      'No additional variables or statements.'
    ]
  },
  reduceAi: {
    kind: 'reduce',
    method: 'reduceAi',
    replacementMethod: 'reduce',
    outputField: 'reducer',
    schemaName: 'reduce_reducer',
    role: 'reducer',
    signature: '(acc, item) => ...',
    parameters: ['acc', 'item'],
    globals: ['Math'],
    allowedMethods: ['localeCompare', 'includes', 'round', 'floor', 'ceil'],
    rules: [
      'Return the updated accumulator for the current item.',
      'Use acc as the current accumulator and item as the current array item.',
      'Only access fields defined in the supplied item or accumulator schemas.',
      'For object accumulators, return a new object and spread acc to keep unchanged fields.',
      'For array accumulators, return a new array such as [...acc, item]; do not mutate acc.',
      'Use arithmetic for numeric changes and Math.round, Math.floor or Math.ceil for rounding.',
      'Use includes or localeCompare for string checks.',
      'No external dependencies.',
      'No mutations.',
      'No additional variables or statements.'
    ]
  }
};
