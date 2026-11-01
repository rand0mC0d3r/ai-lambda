/**
 * Validated settings loaded from `.ai-rc.json`, with defaults applied.
 */
export interface AIConfig {
  /** OpenAI API key used to authorize requests. */
  apiKey: string;
  /** OpenAI model name used for generation. */
  model: string;
  /** Whether generated functions are read from and written to the cache directory. */
  cache: boolean;
  /** Directory, relative to the Vite root, where generated functions are cached. */
  generatedDir: string;
}
