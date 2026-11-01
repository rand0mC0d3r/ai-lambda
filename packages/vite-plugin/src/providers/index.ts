import type { AIConfig } from '../types.js';
import { createAnthropicProvider } from './anthropic.js';
import { createGeminiProvider } from './gemini.js';
import { createOpenAiProvider } from './openai.js';
import { createOpenAiCompatibleProvider } from './openaiCompatible.js';
import type { LlmProvider } from './types.js';

export type { GenerationRequest, GenerationTrace, LlmProvider } from './types.js';

/**
 * Creates the provider selected by `config.provider`.
 *
 * @param config Resolved plugin configuration.
 * @returns The provider that generates functions for this config.
 */
export function createProvider(config: AIConfig): LlmProvider {
  switch (config.provider) {
    case 'openai':
      return createOpenAiProvider(config);
    case 'anthropic':
      return createAnthropicProvider(config);
    case 'gemini':
      return createGeminiProvider(config);
    case 'openai-compatible':
      return createOpenAiCompatibleProvider(config);
  }
}
