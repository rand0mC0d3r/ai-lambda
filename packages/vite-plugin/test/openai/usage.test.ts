import { describe, expect, it } from 'vitest';
import { estimateCostUsd, readUsage } from '../../src/openai/usage.js';

describe('readUsage', () => {
  it('returns undefined when the response has no usage block', () => {
    expect(readUsage({ output_text: '{}' })).toBeUndefined();
  });

  it('reads input, cached, output, and reasoning token counts', () => {
    expect(readUsage({
      usage: {
        input_tokens: 1200,
        input_tokens_details: { cached_tokens: 300 },
        output_tokens: 80,
        output_tokens_details: { reasoning_tokens: 20 }
      }
    })).toEqual({
      inputTokens: 1200,
      cachedInputTokens: 300,
      outputTokens: 80,
      reasoningTokens: 20
    });
  });

  it('defaults missing detail fields to zero', () => {
    expect(readUsage({ usage: { input_tokens: 10, output_tokens: 2 } })).toEqual({
      inputTokens: 10,
      cachedInputTokens: 0,
      outputTokens: 2,
      reasoningTokens: 0
    });
  });
});

describe('estimateCostUsd', () => {
  const usage = {
    inputTokens: 1000,
    cachedInputTokens: 200,
    outputTokens: 100,
    reasoningTokens: 0
  };

  it('bills cached input at the cached rate and the rest at the input rate', () => {
    // 800 * $0.40 + 200 * $0.10 + 100 * $1.60 per 1M tokens
    expect(estimateCostUsd('gpt-4.1-mini', usage)).toBeCloseTo(0.0005, 10);
  });

  it('uses the base model price for dated snapshots', () => {
    expect(estimateCostUsd('gpt-4.1-mini-2025-04-14', usage)).toBeCloseTo(0.0005, 10);
  });

  it('returns undefined for models without pricing data', () => {
    expect(estimateCostUsd('test-model', usage)).toBeUndefined();
  });
});
