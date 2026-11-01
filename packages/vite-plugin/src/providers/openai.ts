import type { Logger } from 'vite';
import { OPENAI_RESPONSES_URL } from '../constants.js';
import { extractGeneratedText } from '../openai/extractGeneratedText.js';
import { readUsage } from '../openai/usage.js';
import type { AIConfig } from '../types.js';
import {
  createHttpError,
  fetchWithRetry,
  outputJsonSchema,
  readJsonBody
} from './common.js';
import type { GenerationRequest, GenerationTrace, LlmProvider } from './types.js';

/**
 * Creates a provider that calls the OpenAI Responses API.
 *
 * @param config Resolved plugin configuration.
 * @returns The OpenAI provider.
 */
export function createOpenAiProvider(config: AIConfig): LlmProvider {
  return {
    async generate(
      request: GenerationRequest,
      trace: GenerationTrace,
      logger: Logger
    ): Promise<string> {
      const { response, attempts } = await fetchWithRetry(
        'openai',
        OPENAI_RESPONSES_URL,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: config.model,
            instructions: request.instructions,
            input: request.input,
            text: {
              format: {
                type: 'json_schema',
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
        throw await createHttpError('openai', response);
      }

      const body = await readJsonBody('openai', response);
      trace.usage = readUsage(body);
      return extractGeneratedText(body);
    }
  };
}
