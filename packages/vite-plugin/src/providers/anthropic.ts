import type { Logger } from 'vite';
import {
  ANTHROPIC_MAX_TOKENS,
  ANTHROPIC_MESSAGES_URL,
  ANTHROPIC_VERSION,
  PROVIDER_LABELS
} from '../constants.js';
import { AIPluginError } from '../errors.js';
import type { TokenUsage } from '../openai/usage.js';
import type { AIConfig } from '../types.js';
import { isRecord, toCount } from '../utils.js';
import { translate } from '../translations/en.js';
import {
  createHttpError,
  fetchWithRetry,
  outputJsonSchema,
  readJsonBody
} from './common.js';
import type { GenerationRequest, GenerationTrace, LlmProvider } from './types.js';

const label = PROVIDER_LABELS.anthropic;

/**
 * Creates a provider that calls the Anthropic Messages API. The output is requested as a
 * forced tool call, so the response carries the function as a JSON object.
 *
 * @param config Resolved plugin configuration.
 * @returns The Anthropic provider.
 */
export function createAnthropicProvider(config: AIConfig): LlmProvider {
  return {
    async generate(
      request: GenerationRequest,
      trace: GenerationTrace,
      logger: Logger
    ): Promise<string> {
      const { response, attempts } = await fetchWithRetry(
        'anthropic',
        ANTHROPIC_MESSAGES_URL,
        {
          method: 'POST',
          headers: {
            'x-api-key': config.apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: config.model,
            max_tokens: ANTHROPIC_MAX_TOKENS,
            system: request.instructions,
            messages: [{ role: 'user', content: request.input }],
            tools: [
              {
                name: request.schemaName,
                description: 'Return the generated function.',
                input_schema: outputJsonSchema(request.outputField)
              }
            ],
            tool_choice: { type: 'tool', name: request.schemaName }
          })
        },
        logger
      );
      trace.attempts = attempts;

      if (!response.ok) {
        throw await createHttpError('anthropic', response);
      }

      const body = await readJsonBody('anthropic', response);
      trace.usage = readAnthropicUsage(body);
      return extractToolInput(body);
    }
  };
}

/**
 * Reads the forced tool call's input object and serializes it as JSON text.
 *
 * @param body The parsed response body.
 * @returns The JSON text of the tool input.
 * @throws {AIPluginError} With code `provider_response` when no tool input is present.
 */
function extractToolInput(body: unknown): string {
  if (!isRecord(body) || !Array.isArray(body.content)) {
    throw new AIPluginError(translate('invalidProviderResponse', { provider: label }), 'provider_response');
  }

  const toolUse = body.content.find(
    (block) => isRecord(block) && block.type === 'tool_use'
  );

  if (!isRecord(toolUse) || !isRecord(toolUse.input)) {
    const details = typeof body.stop_reason === 'string' ? ` (stop_reason=${body.stop_reason})` : '';
    throw new AIPluginError(
      translate('noGeneratedText', { provider: label, details }),
      'provider_response'
    );
  }

  return JSON.stringify(toolUse.input);
}

/**
 * Reads token usage from an Anthropic Messages API payload. Cache writes count as input.
 *
 * @param body The parsed response body.
 * @returns The token counts, or `undefined` when the body has no `usage` object.
 */
function readAnthropicUsage(body: unknown): TokenUsage | undefined {
  if (!isRecord(body) || !isRecord(body.usage)) return undefined;

  const usage = body.usage;
  const cachedInputTokens = toCount(usage.cache_read_input_tokens);

  return {
    inputTokens:
      toCount(usage.input_tokens) +
      cachedInputTokens +
      toCount(usage.cache_creation_input_tokens),
    cachedInputTokens,
    outputTokens: toCount(usage.output_tokens),
    reasoningTokens: 0
  };
}
