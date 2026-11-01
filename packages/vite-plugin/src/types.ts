import type { PROVIDER_IDS } from './constants.js';

/** Identifier of a supported provider. */
export type ProviderId = (typeof PROVIDER_IDS)[number];

/**
 * Validated settings loaded from `.ai-rc.json`, with defaults applied.
 */
export interface AIConfig {
  /** API key used to authorize requests to the provider. Empty when an `openai-compatible` endpoint needs none. */
  apiKey: string;
  /** Provider that generates functions. */
  provider: ProviderId;
  /** Model name used for generation. */
  model: string;
  /** Base URL of the endpoint. Set only for the `openai-compatible` provider, without a trailing slash. */
  baseUrl?: string;
  /** Whether generated functions are read from and written to the cache directory. */
  cache: boolean;
  /** Directory, relative to the Vite root, where generated functions are cached. */
  generatedDir: string;
}
