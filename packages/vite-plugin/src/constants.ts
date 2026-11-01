import { SyntaxKind } from 'typescript/unstable/ast';
import type { AIFunctionSpec } from './aiFunctions.js';

export const DEFAULT_MODEL = 'gpt-4.1-mini';
export const DEFAULT_GENERATED_DIR = '.ai-cache';
export const TSCONFIG_FILE = 'tsconfig.json';
export const AI_CONFIG_FILE = '.ai-rc.json';
export const VITE_PLUGIN_NAME = 'ai-compile-time';
export const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
export const OPENAI_TIMEOUT_MS = 60_000;
export const OPENAI_MAX_RETRIES = 2;
export const OPENAI_RETRY_BASE_DELAY_MS = 250;
export const OPENAI_MAX_RETRY_AFTER_MS = 10_000;
export const COMPILER_VERSION = 1;
export const GENERATED_FUNCTION_TEMP_PREFIX = 'ai-lambda-';
export const GENERATED_FUNCTION_FILE = 'generated.ts';
export const GENERATED_FUNCTION_VARIABLE = '__generated';

const NO_EXTERNAL_RULE = 'No external dependencies.';
const NO_MUTATIONS_RULE = 'No mutations.';
const NO_ADDITIONAL_STATEMENTS_RULE = 'No additional variables or statements.';
const FULL_ARROW_RULE = 'Return the complete arrow function, including its parameter list and "=>", not just the body expression.';
const EXPRESSION_BODY_RULE = 'Use an expression body; do not use a block body or a return statement.';
const NO_CASE_CONVERSION_RULE = 'Do not call toLowerCase or toUpperCase; only includes and localeCompare are allowed.';
const ROUNDING_RULE = 'Use arithmetic for numeric changes and Math.round, Math.floor or Math.ceil for rounding.';
const STRING_CHECK_RULE = 'Use includes or localeCompare for string checks.';
const SCHEMA_FIELDS_RULE = 'Only access fields defined in the supplied schema.';
const COMMON_RULES = [
  FULL_ARROW_RULE,
  NO_EXTERNAL_RULE,
  NO_MUTATIONS_RULE,
  NO_ADDITIONAL_STATEMENTS_RULE,
  EXPRESSION_BODY_RULE,
  NO_CASE_CONVERSION_RULE
];
const MATH_STRING_METHODS = ['localeCompare', 'includes', 'round', 'floor', 'ceil'];

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
      SCHEMA_FIELDS_RULE,
      'Use arithmetic for numeric comparisons.',
      'Use localeCompare with numeric:true and sensitivity:"base" for natural string sorting.',
      ...COMMON_RULES
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
      SCHEMA_FIELDS_RULE,
      'Use comparison operators for numeric, boolean and date comparisons.',
      'Use includes or localeCompare with sensitivity:"base" for case-insensitive string matching.',
      ...COMMON_RULES
    ]
  },
  findAi: {
    kind: 'find',
    method: 'findAi',
    replacementMethod: 'find',
    outputField: 'predicate',
    schemaName: 'find_predicate',
    role: 'predicate',
    signature: '(item) => ...',
    parameters: ['item'],
    allowedMethods: ['localeCompare', 'includes'],
    rules: [
      'Return true when the item is the one to find.',
      'Return false when the item should be skipped.',
      SCHEMA_FIELDS_RULE,
      'Use comparison operators for numeric, boolean and date comparisons.',
      'Use includes or localeCompare with sensitivity:"base" for case-insensitive string matching.',
      ...COMMON_RULES
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
    allowedMethods: MATH_STRING_METHODS,
    rules: [
      'Return the transformed item as an object literal.',
      'Use the spread operator to keep unchanged fields, for example ({...item, unitPrice: value}).',
      SCHEMA_FIELDS_RULE,
      ROUNDING_RULE,
      STRING_CHECK_RULE,
      ...COMMON_RULES
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
    allowedMethods: MATH_STRING_METHODS,
    rules: [
      'Return the updated accumulator for the current item.',
      'Use acc as the current accumulator and item as the current array item.',
      'Only access fields defined in the supplied item or accumulator schemas.',
      'For object accumulators, return a new object and spread acc to keep unchanged fields.',
      'For array accumulators, return a new array such as [...acc, item]; do not mutate acc.',
      ROUNDING_RULE,
      STRING_CHECK_RULE,
      ...COMMON_RULES
    ]
  }
};

export const PERMITTED_SYNTAX_KINDS = new Set([
  SyntaxKind.ArrowFunction,
  SyntaxKind.Parameter,
  SyntaxKind.BinaryExpression,
  SyntaxKind.PropertyAccessExpression,
  SyntaxKind.CallExpression,
  SyntaxKind.Identifier,
  SyntaxKind.NumericLiteral,
  SyntaxKind.StringLiteral,
  SyntaxKind.TrueKeyword,
  SyntaxKind.FalseKeyword,
  SyntaxKind.NullKeyword,
  SyntaxKind.UndefinedKeyword,
  SyntaxKind.ObjectLiteralExpression,
  SyntaxKind.ArrayLiteralExpression,
  SyntaxKind.PropertyAssignment,
  SyntaxKind.ShorthandPropertyAssignment,
  SyntaxKind.SpreadAssignment,
  SyntaxKind.SpreadElement,
  SyntaxKind.CommaToken,
  SyntaxKind.ParenthesizedExpression,
  SyntaxKind.PrefixUnaryExpression,
  SyntaxKind.ConditionalExpression
]);

export const NUMERIC_METHODS = new Set(['round', 'floor', 'ceil']);
export const PROTECTED_PROPERTIES = new Set([
  '__proto__',
  'prototype',
  'constructor'
]);
export const ARITHMETIC_OPERATORS = new Set([
  SyntaxKind.PlusToken,
  SyntaxKind.MinusToken,
  SyntaxKind.AsteriskToken,
  SyntaxKind.AsteriskAsteriskToken,
  SyntaxKind.SlashToken,
  SyntaxKind.PercentToken
]);
export const COMPARISON_OPERATORS = new Set([
  SyntaxKind.LessThanToken,
  SyntaxKind.LessThanEqualsToken,
  SyntaxKind.GreaterThanToken,
  SyntaxKind.GreaterThanEqualsToken,
  SyntaxKind.EqualsEqualsEqualsToken,
  SyntaxKind.ExclamationEqualsEqualsToken
]);
