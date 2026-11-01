import { AI_CONFIG_FILE, TSCONFIG_FILE, VITE_PLUGIN_NAME } from './constants.js';
import { AIPluginError } from './errors.js';
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

function getCodeInsight(error: AIPluginError): string | undefined {
  switch (error.code) {
    case 'missing_api_key':
      return translate('addApiKey', { configFile: AI_CONFIG_FILE });
    case 'invalid_invocation':
      return translate('invalidInvocationInsight');
    case 'unsupported_type':
      return translate('unsupportedTypesInsight');
    case 'type_check':
      return translate('typeCheckInsight', { tsconfigFile: TSCONFIG_FILE });
    case 'invalid_generated':
      return translate('validationInsight');
    case 'openai_network':
      return translate('transformInsight');
    case 'openai_response':
      return translate('invalidResponseInsight');
    case 'openai_http': {
      const status = error.status ?? 0;

      if (status === 401 || status === 403) {
        return translate('invalidCredentialsInsight');
      }

      if (status === 429) return translate('rateLimitInsight');
      if (status >= 500) return translate('serverErrorInsight');
      return undefined;
    }
    case 'invalid_config':
      return undefined;
  }
}

function getInsight(
  error: unknown,
  stage: 'configuration' | 'transform'
): string {
  if (error instanceof AIPluginError) {
    const codeInsight = getCodeInsight(error);

    if (codeInsight) return codeInsight;
  }

  const isOpenAiHttpError =
    error instanceof AIPluginError && error.code === 'openai_http';

  if (stage === 'transform' && !isOpenAiHttpError) {
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
      insight: getInsight(error, 'configuration')
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
      insight: getInsight(error, 'transform')
    }),
    { cause: error }
  );
}
