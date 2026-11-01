import type { Logger } from 'vite';
import { PROVIDER_LABELS } from '../constants.js';
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

const label = PROVIDER_LABELS['openai-compatible'];

/**
 * Creates a provider for any endpoint that implements the OpenAI Chat Completions API,
 * such as local model servers and gateways. The endpoint is `baseUrl` + `/chat/completions`.
 *
 * @param config Resolved plugin configuration. `baseUrl` is set by config validation.
 * @returns The OpenAI-compatible provider.
 */
export function createOpenAiCompatibleProvider(config: AIConfig): LlmProvider {
  return {
    async generate(
      request: GenerationRequest,
      trace: GenerationTrace,
      logger: Logger
    ): Promise<string> {
      const { response, attempts } = await fetchWithRetry(
        'openai-compatible',
        `${config.baseUrl ?? ''}/chat/completions`,
        {
          method: 'POST',
          headers: {
            ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: config.model,
            messages: [
              { role: 'system', content: request.instructions },
              { role: 'user', content: request.input }
            ],
            response_format: {
              type: 'json_schema',
              json_schema: {
                name: request.schemaName,
                strict: true,
                schema: outputJsonSchema(request.outputField)
              }
            }
          })
        },
        logger
      );
      trace.attempts = attempts;

      if (!response.ok) {
        throw await createHttpError('openai-compatible', response);
      }

      const body = await readJsonBody('openai-compatible', response);
      trace.usage = readChatUsage(body);
      return extractMessageContent(body);
    }
  };
}

/**
 * Reads the first choice's message content, reporting a refusal when the model declined.
 *
 * @param body The parsed response body.
 * @returns The message content as JSON text.
 * @throws {AIPluginError} With code `provider_response` when the response has no content.
 */
function extractMessageContent(body: unknown): string {
  if (!isRecord(body) || !Array.isArray(body.choices)) {
    throw new AIPluginError(translate('invalidProviderResponse', { provider: label }), 'provider_response');
  }

  const choice = isRecord(body.choices[0]) ? body.choices[0] : undefined;
  const message = choice && isRecord(choice.message) ? choice.message : undefined;

  if (message && typeof message.content === 'string' && message.content.trim()) {
    return message.content;
  }

  if (message && typeof message.refusal === 'string' && message.refusal.trim()) {
    throw new AIPluginError(
      translate('providerRefusal', { provider: label, refusal: message.refusal }),
      'provider_response'
    );
  }

  const details = choice && typeof choice.finish_reason === 'string'
    ? ` (reason=${choice.finish_reason})`
    : '';

  throw new AIPluginError(
    translate('noGeneratedText', { provider: label, details }),
    'provider_response'
  );
}

/**
 * Reads token usage from a Chat Completions payload.
 *
 * @param body The parsed response body.
 * @returns The token counts, or `undefined` when the body has no `usage` object.
 */
function readChatUsage(body: unknown): TokenUsage | undefined {
  if (!isRecord(body) || !isRecord(body.usage)) return undefined;

  const usage = body.usage;
  const promptDetails = isRecord(usage.prompt_tokens_details) ? usage.prompt_tokens_details : {};
  const completionDetails = isRecord(usage.completion_tokens_details)
    ? usage.completion_tokens_details
    : {};

  return {
    inputTokens: toCount(usage.prompt_tokens),
    cachedInputTokens: toCount(promptDetails.cached_tokens),
    outputTokens: toCount(usage.completion_tokens),
    reasoningTokens: toCount(completionDetails.reasoning_tokens)
  };
}
