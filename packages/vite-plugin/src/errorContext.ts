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

function getCodeInsight(error: unknown): string | undefined {
  if (!(error instanceof AIPluginError)) return undefined;

  switch (error.code) {
    case 'invalid_cache':
      return translate('removeInvalidCache');
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
  }
}

interface InsightRule {
  matches: (error: string) => boolean;
  insight: () => string;
}

const insightRules: InsightRule[] = [
  {
    matches: (error) => error.includes('Missing OpenAI API key'),
    insight: () => translate('addApiKey', { configFile: AI_CONFIG_FILE })
  },
  {
    matches: (error) => error.includes('Invalid ') && error.includes(' invocation'),
    insight: () => translate('invalidInvocationInsight')
  },
  {
    matches: (error) =>
      error.includes('items must be an array') ||
      (error.includes('Unsupported ') && error.includes('field type')) ||
      error.includes('could not infer') ||
      error.includes('initialValue must have'),
    insight: () => translate('unsupportedTypesInsight')
  },
  {
    matches: (error) => error.includes('Unable to type-check'),
    insight: () => translate('typeCheckInsight', { tsconfigFile: TSCONFIG_FILE })
  },
  {
    matches: (error) =>
      error.includes('generated') ||
      error.includes('Forbidden') ||
      error.includes('permitted') ||
      error.includes('Only '),
    insight: () => translate('validationInsight')
  }
];

function getInsight(
  error: unknown,
  cause: string,
  stage: 'configuration' | 'transform'
): string {
  const codeInsight = getCodeInsight(error);

  if (codeInsight) {
    return codeInsight;
  }

  const rule = insightRules.find((candidate) => candidate.matches(cause));

  if (rule) {
    return rule.insight();
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
      insight: getInsight(error, cause, 'configuration')
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
      insight: getInsight(error, cause, 'transform')
    }),
    { cause: error }
  );
}
