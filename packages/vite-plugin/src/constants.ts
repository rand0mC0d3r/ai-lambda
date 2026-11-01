import { SyntaxKind } from 'typescript/unstable/ast';
import type { AIFunctionSpec } from './aiFunctions.js';

/** Provider used when `.ai-rc.json` does not set `provider`. */
export const DEFAULT_PROVIDER = 'openai';
/** Providers accepted in the `provider` key of `.ai-rc.json`. */
export const PROVIDER_IDS = ['openai', 'anthropic', 'gemini', 'openai-compatible'] as const;
/** Display names of providers, used in logs and error messages. */
export const PROVIDER_LABELS: Record<(typeof PROVIDER_IDS)[number], string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Gemini',
  'openai-compatible': 'OpenAI-compatible'
};
/** Model used with the OpenAI provider when `.ai-rc.json` does not set `model`. Other providers require `model`. */
export const DEFAULT_MODEL = 'gpt-4.1-mini';
/** Cache directory used when `.ai-rc.json` does not set `generatedDir`, relative to the Vite root. */
export const DEFAULT_GENERATED_DIR = '.ai-cache';
/** Name of the TypeScript config file that must exist at the Vite root. */
export const TSCONFIG_FILE = 'tsconfig.json';
/** Name of the plugin config file that must exist at the Vite root. */
export const AI_CONFIG_FILE = '.ai-rc.json';
/** Plugin name reported to Vite and included in error messages. */
export const VITE_PLUGIN_NAME = 'ai-compile-time';
/** OpenAI Responses API endpoint. */
export const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
/** Anthropic Messages API endpoint. */
export const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
/** Value of the `anthropic-version` header. */
export const ANTHROPIC_VERSION = '2023-06-01';
/** Output token limit for Anthropic requests. The API requires one; generated functions are small. */
export const ANTHROPIC_MAX_TOKENS = 4096;
/** Gemini API base URL. The model name and `:generateContent` are appended. */
export const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
/** Timeout for each provider request, in milliseconds. */
export const PROVIDER_TIMEOUT_MS = 60_000;
/** Number of retries after the first provider attempt fails. */
export const PROVIDER_MAX_RETRIES = 2;
/** Base delay for exponential backoff between provider retries, in milliseconds. */
export const PROVIDER_RETRY_BASE_DELAY_MS = 250;
/** Upper bound on a server-requested `Retry-After` delay, in milliseconds. */
export const PROVIDER_MAX_RETRY_AFTER_MS = 10_000;
/** Version of the generation format. Bump it to invalidate cached functions. */
export const COMPILER_VERSION = 1;
/** Prefix for the temporary directories used during validation. */
export const GENERATED_FUNCTION_TEMP_PREFIX = 'ai-lambda-';
/** File name of the temporary module that holds a generated function. */
export const GENERATED_FUNCTION_FILE = 'generated.ts';
/** Variable name that holds the generated function in the temporary module. */
export const GENERATED_FUNCTION_VARIABLE = '__generated';

// Prompt rules included in each method's spec. Shared rules are combined in COMMON_RULES.
const NO_EXTERNAL_RULE = 'No external dependencies.';
const NO_MUTATIONS_RULE = 'No mutations.';
const NO_ADDITIONAL_STATEMENTS_RULE = 'No additional variables or statements.';
const FULL_ARROW_RULE = 'Return the complete arrow function, including its parameter list and "=>", not just the body expression.';
const EXPRESSION_BODY_RULE = 'Use an expression body; do not use a block body or a return statement.';
const NO_CASE_CONVERSION_RULE = 'Do not call toLowerCase or toUpperCase; only includes and localeCompare are allowed.';
const ROUNDING_RULE = 'Use arithmetic for numeric changes and Math.round, Math.floor or Math.ceil for rounding.';
const STRING_CHECK_RULE = 'Use includes or localeCompare for string checks.';
const SCHEMA_FIELDS_RULE = 'Only access fields defined in the supplied schema.';
/** Rules that apply to every AI method. */
const COMMON_RULES = [
  FULL_ARROW_RULE,
  NO_EXTERNAL_RULE,
  NO_MUTATIONS_RULE,
  NO_ADDITIONAL_STATEMENTS_RULE,
  EXPRESSION_BODY_RULE,
  NO_CASE_CONVERSION_RULE
];
/** Methods that the generated code may call on `Math` and on strings. */
const MATH_STRING_METHODS = ['localeCompare', 'includes', 'round', 'floor', 'ceil'];

/**
 * Specs for each supported AI array method, keyed by source method name.
 */
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
  someAi: {
    kind: 'some',
    method: 'someAi',
    replacementMethod: 'some',
    outputField: 'predicate',
    schemaName: 'some_predicate',
    role: 'predicate',
    signature: '(item) => ...',
    parameters: ['item'],
    allowedMethods: ['localeCompare', 'includes'],
    rules: [
      'Return true when the item satisfies the instruction.',
      'Return false when the item does not satisfy the instruction.',
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

/**
 * AST node kinds that generated code may contain. Anything else is rejected during validation.
 */
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

/** `Math` methods that generated code may call for numeric rounding. */
export const NUMERIC_METHODS = new Set(['round', 'floor', 'ceil']);
/** Property names that generated code may not access, to block prototype manipulation. */
export const PROTECTED_PROPERTIES = new Set([
  '__proto__',
  'prototype',
  'constructor'
]);
/** Binary operators that generated code may use for arithmetic. */
export const ARITHMETIC_OPERATORS = new Set([
  SyntaxKind.PlusToken,
  SyntaxKind.MinusToken,
  SyntaxKind.AsteriskToken,
  SyntaxKind.AsteriskAsteriskToken,
  SyntaxKind.SlashToken,
  SyntaxKind.PercentToken
]);
/** Strict comparison operators that generated code may use. */
export const COMPARISON_OPERATORS = new Set([
  SyntaxKind.LessThanToken,
  SyntaxKind.LessThanEqualsToken,
  SyntaxKind.GreaterThanToken,
  SyntaxKind.GreaterThanEqualsToken,
  SyntaxKind.EqualsEqualsEqualsToken,
  SyntaxKind.ExclamationEqualsEqualsToken
]);
