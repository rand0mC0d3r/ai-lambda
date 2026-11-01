import type { Logger } from 'vite';
import { GEMINI_API_BASE_URL, PROVIDER_LABELS } from '../constants.js';
import { AIPluginError } from '../errors.js';
import type { TokenUsage } from '../openai/usage.js';
import type { AIConfig } from '../types.js';
import { isRecord, toCount } from '../utils.js';
import { translate } from '../translations/en.js';
import {
  createHttpError,
  fetchWithRetry,
  readJsonBody
} from './common.js';
import type { GenerationRequest, GenerationTrace, LlmProvider } from './types.js';

const label = PROVIDER_LABELS.gemini;

/**
 * Creates a provider that calls the Gemini `generateContent` API with a JSON response schema.
 *
 * @param config Resolved plugin configuration.
 * @returns The Gemini provider.
 */
export function createGeminiProvider(config: AIConfig): LlmProvider {
  return {
    async generate(
      request: GenerationRequest,
      trace: GenerationTrace,
      logger: Logger
    ): Promise<string> {
      const url = `${GEMINI_API_BASE_URL}/${encodeURIComponent(config.model)}:generateContent`;
      const { response, attempts } = await fetchWithRetry(
        'gemini',
        url,
        {
          method: 'POST',
          headers: {
            'x-goog-api-key': config.apiKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: request.instructions }] },
            contents: [{ role: 'user', parts: [{ text: request.input }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              // Gemini's schema dialect uses upper-case type names and does not accept additionalProperties.
              responseSchema: {
                type: 'OBJECT',
                properties: {
                  [request.outputField]: { type: 'STRING' }
                },
                required: [request.outputField]
              }
            }
          })
        },
        logger
      );
      trace.attempts = attempts;

      if (!response.ok) {
        throw await createHttpError('gemini', response);
      }

      const body = await readJsonBody('gemini', response);
      trace.usage = readGeminiUsage(body);
      return extractCandidateText(body);
    }
  };
}

/**
 * Concatenates the text parts of the first candidate, skipping model thought summaries.
 *
 * @param body The parsed response body.
 * @returns The concatenated text.
 * @throws {AIPluginError} With code `provider_response` when the response has no text.
 */
function extractCandidateText(body: unknown): string {
  if (!isRecord(body) || !Array.isArray(body.candidates)) {
    throw new AIPluginError(translate('invalidProviderResponse', { provider: label }), 'provider_response');
  }

  const candidate = isRecord(body.candidates[0]) ? body.candidates[0] : undefined;
  const content = candidate && isRecord(candidate.content) ? candidate.content : undefined;
  const parts = content && Array.isArray(content.parts) ? content.parts : [];

  let text = '';

  for (const part of parts) {
    if (isRecord(part) && part.thought !== true && typeof part.text === 'string') {
      text += part.text;
    }
  }

  if (text.trim()) return text;

  const promptFeedback = isRecord(body.promptFeedback) ? body.promptFeedback : {};
  const details = [
    candidate && typeof candidate.finishReason === 'string' && `reason=${candidate.finishReason}`,
    typeof promptFeedback.blockReason === 'string' && `block=${promptFeedback.blockReason}`
  ].filter(Boolean);

  throw new AIPluginError(
    translate('noGeneratedText', {
      provider: label,
      details: details.length ? ` (${details.join(', ')})` : ''
    }),
    'provider_response'
  );
}

/**
 * Reads token usage from a Gemini `generateContent` payload. Thought tokens count as output.
 *
 * @param body The parsed response body.
 * @returns The token counts, or `undefined` when the body has no `usageMetadata` object.
 */
function readGeminiUsage(body: unknown): TokenUsage | undefined {
  if (!isRecord(body) || !isRecord(body.usageMetadata)) return undefined;

  const usage = body.usageMetadata;
  const reasoningTokens = toCount(usage.thoughtsTokenCount);

  return {
    inputTokens: toCount(usage.promptTokenCount),
    cachedInputTokens: toCount(usage.cachedContentTokenCount),
    outputTokens: toCount(usage.candidatesTokenCount) + reasoningTokens,
    reasoningTokens
  };
}
