import { isRecord } from '../utils.js';

/**
 * Token counts reported by one OpenAI response.
 */
export interface TokenUsage {
  /** Total input tokens, including cached tokens. */
  inputTokens: number;
  /** Input tokens served from the prompt cache. */
  cachedInputTokens: number;
  /** Output tokens, including reasoning tokens. */
  outputTokens: number;
  /** Output tokens spent on internal reasoning. */
  reasoningTokens: number;
}

/**
 * Prices in USD per one million tokens.
 */
interface ModelPricing {
  inputPerMillion: number;
  cachedInputPerMillion: number;
  outputPerMillion: number;
}

// Standard-tier USD prices per 1M tokens from https://developers.openai.com/api/docs/pricing.
// Update when OpenAI changes prices; models missing here report cost as n/a.
const MODEL_PRICING: Record<string, ModelPricing> = {
  'gpt-4.1': { inputPerMillion: 2, cachedInputPerMillion: 0.5, outputPerMillion: 8 },
  'gpt-4.1-mini': { inputPerMillion: 0.4, cachedInputPerMillion: 0.1, outputPerMillion: 1.6 },
  'gpt-4.1-nano': { inputPerMillion: 0.1, cachedInputPerMillion: 0.025, outputPerMillion: 0.4 },
  'gpt-4o': { inputPerMillion: 2.5, cachedInputPerMillion: 1.25, outputPerMillion: 10 },
  'gpt-4o-mini': { inputPerMillion: 0.15, cachedInputPerMillion: 0.075, outputPerMillion: 0.6 },
  'gpt-5': { inputPerMillion: 1.25, cachedInputPerMillion: 0.125, outputPerMillion: 10 },
  'gpt-5-mini': { inputPerMillion: 0.25, cachedInputPerMillion: 0.025, outputPerMillion: 2 },
  'gpt-5-nano': { inputPerMillion: 0.05, cachedInputPerMillion: 0.005, outputPerMillion: 0.4 },
  'gpt-5.4-mini': { inputPerMillion: 0.75, cachedInputPerMillion: 0.075, outputPerMillion: 4.5 },
  'gpt-5.4-nano': { inputPerMillion: 0.2, cachedInputPerMillion: 0.02, outputPerMillion: 1.25 }
};

/**
 * Converts an unknown value to a count, treating anything that is not a finite number as zero.
 *
 * @param value The raw value from the response.
 * @returns The number, or `0`.
 */
function toCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Reads token usage from an OpenAI Responses API payload.
 *
 * @param body The parsed response body.
 * @returns The token counts, or `undefined` when the body has no `usage` object.
 */
export function readUsage(body: unknown): TokenUsage | undefined {
  if (!isRecord(body) || !isRecord(body.usage)) return undefined;

  const usage = body.usage;
  const inputDetails: Record<string, unknown> = isRecord(usage.input_tokens_details)
    ? usage.input_tokens_details
    : {};
  const outputDetails: Record<string, unknown> = isRecord(usage.output_tokens_details)
    ? usage.output_tokens_details
    : {};

  return {
    inputTokens: toCount(usage.input_tokens),
    cachedInputTokens: toCount(inputDetails.cached_tokens),
    outputTokens: toCount(usage.output_tokens),
    reasoningTokens: toCount(outputDetails.reasoning_tokens)
  };
}

/**
 * Estimates the USD cost of a request from its token usage and the model's pricing.
 * Dated snapshots such as `gpt-4.1-mini-2025-04-14` share their base model's price.
 *
 * @param model The model name used for the request.
 * @param usage The token counts for the request.
 * @returns The estimated cost in USD, or `undefined` when the model has no pricing entry.
 */
export function estimateCostUsd(model: string, usage: TokenUsage): number | undefined {
  const baseModel = model.replace(/-\d{4}-\d{2}-\d{2}$/, '');
  if (!Object.hasOwn(MODEL_PRICING, baseModel)) return undefined;

  const pricing = MODEL_PRICING[baseModel];
  const uncachedInputTokens = Math.max(usage.inputTokens - usage.cachedInputTokens, 0);

  return (
    uncachedInputTokens * pricing.inputPerMillion +
    usage.cachedInputTokens * pricing.cachedInputPerMillion +
    usage.outputTokens * pricing.outputPerMillion
  ) / 1_000_000;
}
