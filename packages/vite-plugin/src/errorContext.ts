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

interface InsightRule {
  matches: (error: string) => boolean;
  insight: () => string;
}

const insightRules: InsightRule[] = [
  {
    matches: (error) => error.toLowerCase().includes('cached'),
    insight: () => translate('removeInvalidCache')
  },
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
      error.startsWith('OpenAI error 401') || error.startsWith('OpenAI error 403'),
    insight: () => translate('invalidCredentialsInsight')
  },
  {
    matches: (error) => error.startsWith('OpenAI error 429'),
    insight: () => translate('rateLimitInsight')
  },
  {
    matches: (error) => error.startsWith('OpenAI error 5'),
    insight: () => translate('serverErrorInsight')
  },
  {
    matches: (error) =>
      (error.includes('invalid ') && error.includes(' JSON')) ||
      error.includes('returned no generated text') ||
      error.includes('response is missing a'),
    insight: () => translate('invalidResponseInsight')
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

function getInsight(error: string, stage: 'configuration' | 'transform'): string {
  const rule = insightRules.find((candidate) => candidate.matches(error));

  if (rule) {
    return rule.insight();
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
