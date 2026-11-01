import { AI_CONFIG_FILE, TSCONFIG_FILE, VITE_PLUGIN_NAME } from './constants.js';
import { AIPluginError } from './errors.js';
import { translate } from './translations/en.js';

/**
 * Location and request details attached to a transform failure message.
 */
interface TransformErrorContext {
  file: string;
  line: number;
  column: number;
  method: string;
  instruction: string;
  model: string;
}

/**
 * Returns the message of an `Error`, or the string form of any other thrown value.
 *
 * @param error The thrown value.
 * @returns A human-readable message.
 */
function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Returns the translated troubleshooting hint for a specific plugin error code.
 *
 * @param error The plugin error to describe.
 * @returns The insight text, or `undefined` when the code has no specific hint.
 */
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
    case 'provider_network':
      return translate('transformInsight');
    case 'provider_response':
      return translate('invalidResponseInsight');
    case 'provider_http': {
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

/**
 * Chooses the most useful hint for an error, falling back to a generic hint for
 * the stage in which it occurred.
 *
 * @param error The thrown value.
 * @param stage Whether the error happened while reading configuration or transforming a module.
 * @returns The insight text to include in the error message.
 */
function getInsight(
  error: unknown,
  stage: 'configuration' | 'transform'
): string {
  if (error instanceof AIPluginError) {
    const codeInsight = getCodeInsight(error);

    if (codeInsight) return codeInsight;
  }

  const isProviderHttpError =
    error instanceof AIPluginError && error.code === 'provider_http';

  if (stage === 'transform' && !isProviderHttpError) {
    return translate('transformInsight');
  }

  return translate('configurationInsight', {
    tsconfigFile: TSCONFIG_FILE,
    configFile: AI_CONFIG_FILE
  });
}

/**
 * Wraps a startup or configuration failure in an error that names the Vite root
 * and the expected config files.
 *
 * @param error The original failure.
 * @param root The resolved Vite root directory.
 * @returns A new `Error` whose `cause` is the original failure.
 */
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

/**
 * Wraps a failure from compiling one AI call in an error that includes the
 * source location, method, model, and a truncated instruction.
 *
 * @param error The original failure.
 * @param context The location and request details of the AI call.
 * @returns A new `Error` whose `cause` is the original failure.
 */
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
