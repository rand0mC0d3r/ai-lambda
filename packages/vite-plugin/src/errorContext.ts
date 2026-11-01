import { AI_CONFIG_FILE, TSCONFIG_FILE, VITE_PLUGIN_NAME } from './constants.js';

interface TransformErrorContext {
  file: string;
  line: number;
  column: number;
  method: string;
  instruction: string;
  model: string;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getInsight(error: string, stage: 'configuration' | 'transform'): string {
  if (error.toLowerCase().includes('cached')) {
    return 'Remove the invalid generated cache entry in the configured generatedDir and retry so the function can be generated again.';
  }

  if (error.includes('Missing OpenAI API key')) {
    return `Add a valid apiKey to ${AI_CONFIG_FILE} in the resolved Vite root.`;
  }

  if (error.includes('Invalid ') && error.includes(' invocation')) {
    return 'Pass a string literal as the instruction; reduceAi() also requires an initial value, and only mapAi()/reduceAi() accept type arguments.';
  }

  if (
    error.includes('items must be an array') ||
    error.includes('Unsupported ') && error.includes('field type') ||
    error.includes('could not infer') ||
    error.includes('initialValue must have')
  ) {
    return 'Ensure the TypeScript project includes this source file and uses arrays with supported scalar or Date fields; nested and mixed-union field types are not supported.';
  }

  if (error.includes('Unable to type-check')) {
    return `Ensure the transformed file is included in ${TSCONFIG_FILE} and that Vite's transformed source matches the TypeScript project source.`;
  }

  if (error.startsWith('OpenAI error 401') || error.startsWith('OpenAI error 403')) {
    return 'Verify the API key and confirm it has access to the configured model.';
  }

  if (error.startsWith('OpenAI error 429')) {
    return 'Check the account quota and rate limits, then retry after the limit resets.';
  }

  if (error.startsWith('OpenAI error 5')) {
    return 'The OpenAI service returned a server error; retry later and check the response details above.';
  }

  if (
    error.includes('invalid ') && error.includes(' JSON') ||
    error.includes('returned no generated text') ||
    error.includes('response is missing a')
  ) {
    return 'The configured model did not return the expected function. Simplify the instruction and retry; also verify the model supports structured JSON output.';
  }

  if (
    error.includes('generated') ||
    error.includes('Forbidden') ||
    error.includes('permitted') ||
    error.includes('Only ')
  ) {
    return 'The generated function did not meet the plugin’s validation rules. Simplify the instruction to use supported fields and helpers, then retry; if this came from cache, remove the generated cache entry.';
  }

  if (stage === 'transform' && !error.startsWith('OpenAI error ')) {
    return 'Check network access, the configured model, and the instruction; the underlying cause above contains the specific failure.';
  }

  return `Check ${TSCONFIG_FILE} and ${AI_CONFIG_FILE} at the resolved Vite root; the underlying cause above contains the specific failure.`;
}

export function createConfigurationError(error: unknown, root: string): Error {
  const cause = getErrorMessage(error);

  return new Error(
    `[${VITE_PLUGIN_NAME}] Failed to initialize for Vite root "${root}".\n` +
      `Details: expected ${TSCONFIG_FILE} and ${AI_CONFIG_FILE} at that root.\n` +
      `Cause: ${cause}\n` +
      `Insight: ${getInsight(cause, 'configuration')}`,
    { cause: error }
  );
}

export function createTransformError(
  error: unknown,
  context: TransformErrorContext
): Error {
  const cause = getErrorMessage(error);
  const instruction =
    context.instruction.length > 200
      ? `${context.instruction.slice(0, 197)}...`
      : context.instruction;

  return new Error(
    `[${VITE_PLUGIN_NAME}] Failed to compile ${context.method}() in ${context.file}:${context.line}:${context.column}.\n` +
      `Details: model=${context.model}; instruction=${JSON.stringify(instruction)}.\n` +
      `Cause: ${cause}\n` +
      `Insight: ${getInsight(cause, 'transform')}`,
    { cause: error }
  );
}
