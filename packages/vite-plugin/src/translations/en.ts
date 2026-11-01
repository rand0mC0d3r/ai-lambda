/**
 * English message templates. Placeholders use the form `{{name}}` and are filled by {@link translate}.
 */
const english = {
  typescriptApiNotInitialized: 'TypeScript API is not initialized',
  unableToLoadTypeScriptProject: 'Unable to load TypeScript project {{tsconfigPath}}',
  missingApiKey: 'Missing OpenAI API key in .ai-rc.json',
  invalidAiConfigJson: '{{configFile}} is not valid JSON: {{cause}}',
  aiConfigNotObject: '{{configFile}} must contain a JSON object',
  unknownAiConfigKeys: 'Unknown key(s) in {{configFile}}: {{keys}}. Supported keys are apiKey, model, cache, and generatedDir',
  invalidApiKey: 'apiKey in {{configFile}} must be a non-empty string',
  invalidModel: 'model in {{configFile}} must be a non-empty string',
  invalidCache: 'cache in {{configFile}} must be true or false',
  invalidGeneratedDir: 'generatedDir in {{configFile}} must be a relative path inside the Vite root',
  unableToTypeCheckAiCall: 'Unable to type-check AI call in {{id}}',
  transformedSourceMismatch: 'Unable to type-check transformed AI call in {{id}}: source does not match the TypeScript project',
  invalidInvocation: 'Invalid {{method}}() invocation in {{id}}',
  invalidCachedFunction: 'Invalid cached {{role}}',
  unreadableCacheFile: 'Ignoring unreadable cache file {{cacheFile}}; regenerating.',
  invalidCacheRegenerating: 'Ignoring invalid cache file {{cacheFile}} ({{reason}}); regenerating.',
  openAiRetryNetwork: 'OpenAI request failed: {{message}}. Retrying in {{delay}}ms.',
  openAiRetryStatus: 'OpenAI returned {{status}}. Retrying in {{delay}}ms.',
  aiCompiling: '\n🤖 AI compiling {{method}}(): "{{instruction}}"',
  generatedFunction: '✅ Generated: {{generated}}',
  openAiHttpError: 'OpenAI error {{status}}: {{body}}',
  openAiNetworkError: 'OpenAI request failed after {{attempts}} attempt(s): {{cause}}',
  invalidGeneratedJson: 'OpenAI returned invalid {{role}} JSON',
  missingGeneratedFunction: 'OpenAI response is missing a {{role}} string',
  invalidOpenAiResponse: 'OpenAI returned an invalid response',
  openAiRefusal: 'OpenAI refused AI function generation: {{refusal}}',
  noGeneratedText: 'OpenAI returned no generated text{{details}}',
  unsupportedFieldType: 'Unsupported {{method}}() field type for "{{propertyName}}": {{type}}',
  itemsMustBeArray: '{{method}}() items must be an array',
  cannotInferInitialValueType: '{{method}}() could not infer initialValue type',
  cannotInferArrayAccumulatorType: '{{method}}() could not infer array accumulator type',
  unsupportedArrayInitialValue: '{{method}}() array initialValue must have supported scalar or object elements',
  unsupportedInitialValue: '{{method}}() initialValue must have a supported scalar or object type',
  unableToParseGeneratedFunction: 'Unable to parse generated JavaScript function',
  invalidGeneratedSyntax: 'Invalid generated JavaScript syntax',
  invalidGeneratedDeclaration: 'Invalid generated function declaration',
  invalidArrowFunction: 'Generated function must be an expression-bodied ({{parameters}}) arrow function',
  arrayLiteralNotAllowed: 'Array literals are only permitted in reduceAi reducers',
  computedPropertyNotAllowed: 'Computed object properties are not permitted',
  forbiddenObjectProperty: 'Forbidden object property: {{name}}',
  shorthandPropertyNotAllowed: 'Shorthand object properties are not permitted',
  objectSpreadNotAllowed: 'Object spread is only permitted on object parameters',
  arraySpreadNotAllowed: 'Array spread is only permitted on array parameters',
  forbiddenIdentifier: 'Forbidden identifier: {{name}}',
  thisAndSuperNotAllowed: 'this and super are not permitted',
  forbiddenPropertyAccess: 'Forbidden property access: {{property}}',
  onlyAllowedCalls: 'Only {{methods}} calls are permitted',
  arithmeticRequiresNumbers: 'Arithmetic operators require numeric expressions',
  looseEqualityNotAllowed: 'Loose equality operators are not permitted',
  forbiddenOperator: 'Forbidden JavaScript operator: {{operator}}',
  forbiddenSyntax: 'Forbidden JavaScript syntax: {{syntax}}',
  undeclaredResultField: 'Generated result has undeclared field: {{name}}',
  missingResultField: 'Generated result is missing declared field: {{name}}',
  resultNotObject: 'Generated result must be an object literal or an object parameter because the result type is an object',
  semanticTypeMismatch: 'Generated {{role}} does not match the declared types: {{detail}}',
  addApiKey: 'Add a valid apiKey to {{configFile}} in the resolved Vite root.',
  invalidInvocationInsight: 'Pass a string literal as the instruction; reduceAi() also requires an initial value, and only mapAi()/reduceAi() accept type arguments.',
  unsupportedTypesInsight: 'Ensure the TypeScript project includes this source file and uses arrays with supported scalar or Date fields; nested and mixed-union field types are not supported.',
  typeCheckInsight: 'Ensure the transformed file is included in {{tsconfigFile}} and that Vite\'s transformed source matches the TypeScript project source.',
  invalidCredentialsInsight: 'Verify the API key and confirm it has access to the configured model.',
  rateLimitInsight: 'Check the account quota and rate limits, then retry after the limit resets.',
  serverErrorInsight: 'The OpenAI service returned a server error; retry later and check the response details above.',
  invalidResponseInsight: 'The configured model did not return the expected function. Simplify the instruction and retry; also verify the model supports structured JSON output.',
  validationInsight: 'The generated function did not meet the plugin’s validation rules. Simplify the instruction to use supported fields and helpers, then retry.',
  transformInsight: 'Check network access, the configured model, and the instruction; the underlying cause above contains the specific failure.',
  configurationInsight: 'Check {{tsconfigFile}} and {{configFile}} at the resolved Vite root; the underlying cause above contains the specific failure.',
  configurationError: '[{{pluginName}}] Failed to initialize for Vite root "{{root}}".\nDetails: expected {{tsconfigFile}} and {{configFile}} at that root.\nCause: {{cause}}\nInsight: {{insight}}',
  transformError: '[{{pluginName}}] Failed to compile {{method}}() in {{file}}:{{line}}:{{column}}.\nDetails: model={{model}}; instruction={{instruction}}.\nCause: {{cause}}\nInsight: {{insight}}',
  missingConfigResolvedHook: 'Plugin has no configResolved hook',
  missingTransformHook: 'Plugin has no transform hook'
} as const;

/**
 * A key of an English message template.
 */
type TranslationKey = keyof typeof english;
/**
 * Values used to fill `{{name}}` placeholders in a message template.
 */
type TranslationValues = Record<string, string | number>;

/**
 * Looks up a message template and fills in its placeholders.
 * Placeholders without a matching value are left unchanged.
 *
 * @param key The message key.
 * @param values Values for the placeholders.
 * @returns The formatted message.
 */
export function translate(
  key: TranslationKey,
  values: TranslationValues = {}
): string {
  return english[key].replace(/\{\{(\w+)\}\}/g, (placeholder, name: string) => {
    const value = values[name];
    return value === undefined ? placeholder : String(value);
  });
}
