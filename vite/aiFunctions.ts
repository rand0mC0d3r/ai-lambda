export interface AIFunctionSpec {
  kind: 'sort' | 'filter';
  method: string;
  replacementMethod: 'toSorted' | 'filter';
  outputField: string;
  schemaName: string;
  role: string;
  signature: string;
  parameters: readonly string[];
  allowedMethods: readonly string[];
  rules: readonly string[];
}

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
  }
};
