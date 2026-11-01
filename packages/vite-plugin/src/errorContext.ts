import { AI_CONFIG_FILE, TSCONFIG_FILE, VITE_PLUGIN_NAME } from './constants.js';
import { translate } from './translations/en.js';

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
    return translate('removeInvalidCache');
  }

  if (error.includes('Missing OpenAI API key')) {
    return translate('addApiKey', { configFile: AI_CONFIG_FILE });
  }

  if (error.includes('Invalid ') && error.includes(' invocation')) {
    return translate('invalidInvocationInsight');
  }

  if (
    error.includes('items must be an array') ||
    error.includes('Unsupported ') && error.includes('field type') ||
    error.includes('could not infer') ||
    error.includes('initialValue must have')
  ) {
    return translate('unsupportedTypesInsight');
  }

  if (error.includes('Unable to type-check')) {
    return translate('typeCheckInsight', { tsconfigFile: TSCONFIG_FILE });
  }

  if (error.startsWith('OpenAI error 401') || error.startsWith('OpenAI error 403')) {
    return translate('invalidCredentialsInsight');
  }

  if (error.startsWith('OpenAI error 429')) {
    return translate('rateLimitInsight');
  }

  if (error.startsWith('OpenAI error 5')) {
    return translate('serverErrorInsight');
  }

  if (
    error.includes('invalid ') && error.includes(' JSON') ||
    error.includes('returned no generated text') ||
    error.includes('response is missing a')
  ) {
    return translate('invalidResponseInsight');
  }

  if (
    error.includes('generated') ||
    error.includes('Forbidden') ||
    error.includes('permitted') ||
    error.includes('Only ')
  ) {
    return translate('validationInsight');
  }

  if (stage === 'transform' && !error.startsWith('OpenAI error ')) {
    return translate('transformInsight');
  }

  return translate('configurationInsight', {
    tsconfigFile: TSCONFIG_FILE,
    configFile: AI_CONFIG_FILE
  });
}

export function createConfigurationError(error: unknown, root: string): Error {
  const cause = getErrorMessage(error);

  return new Error(
    translate('configurationError', {
      pluginName: VITE_PLUGIN_NAME,
      root,
      tsconfigFile: TSCONFIG_FILE,
      configFile: AI_CONFIG_FILE,
      cause,
      insight: getInsight(cause, 'configuration')
    }),
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
    translate('transformError', {
      pluginName: VITE_PLUGIN_NAME,
      method: context.method,
      file: context.file,
      line: context.line,
      column: context.column,
      model: context.model,
      instruction: JSON.stringify(instruction),
      cause,
      insight: getInsight(cause, 'transform')
    }),
    { cause: error }
  );
}
