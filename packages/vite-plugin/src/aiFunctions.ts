/**
 * Describes how one supported AI array method is compiled and validated.
 */
export interface AIFunctionSpec {
  /** Which kind of AI method this is. */
  kind: 'sort' | 'filter' | 'find' | 'some' | 'map' | 'reduce';
  /** Source method name, such as `filterAi`. */
  method: string;
  /** Native array method the call is rewritten to, such as `filter`. */
  replacementMethod: 'toSorted' | 'filter' | 'find' | 'some' | 'map' | 'reduce';
  /** JSON field in the model response that holds the generated code. */
  outputField: string;
  /** Name of the JSON schema sent to OpenAI for structured output. */
  schemaName: string;
  /** Short role name used in prompts and messages, such as `predicate`. */
  role: string;
  /** Arrow-function signature shown to the model. */
  signature: string;
  /** Names of the generated function's parameters, in order. */
  parameters: readonly string[];
  /** Global identifiers the generated code may reference, such as `Math`. */
  globals?: readonly string[];
  /** Method names the generated code may call on values. */
  allowedMethods: readonly string[];
  /** Extra rules included in the generation prompt. */
  rules: readonly string[];
}

/**
 * Describes the keys a `reduceAi` or `mapAi` result must provide.
 */
export interface ResultShape {
  /** Declared field names mapped to their simple types. */
  fields: Record<string, string>;
  /** Field names that may be omitted from the result. */
  optionalFields: string[];
}

/**
 * Describes what a generated function must return and accept, for checking
 * the generated code against the declared types.
 */
export interface ExpectedResult {
  /** Result keys to check. Used for a cache key, so it is kept separate from the type text. */
  shape?: ResultShape;
  /** TypeScript type text for each spec parameter, keyed by parameter name. */
  parameters?: Record<string, string>;
  /** TypeScript type text for the declared result, when it can be expressed. */
  result?: string;
}

/**
 * Describes the type of a generated function parameter: a scalar, an object
 * with simple fields, or an array of scalars or objects.
 */
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
