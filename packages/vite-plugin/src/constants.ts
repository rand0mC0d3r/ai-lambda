import { SyntaxKind } from 'typescript/unstable/ast';
import type { AIFunctionSpec } from './aiFunctions.js';

export const DEFAULT_MODEL = 'gpt-4.1-mini';
export const DEFAULT_GENERATED_DIR = '.ai-cache';
export const TSCONFIG_FILE = 'tsconfig.json';
export const AI_CONFIG_FILE = '.ai-rc.json';
export const VITE_PLUGIN_NAME = 'ai-compile-time';
export const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
export const COMPILER_VERSION = 1;
export const GENERATED_FUNCTION_TEMP_PREFIX = 'ai-lambda-';
export const GENERATED_FUNCTION_FILE = 'generated.ts';
export const GENERATED_FUNCTION_VARIABLE = '__generated';

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
