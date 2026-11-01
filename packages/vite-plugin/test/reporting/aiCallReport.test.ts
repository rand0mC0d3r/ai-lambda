import { beforeEach, describe, expect, it } from 'vitest';
import {
  finishAiCall,
  formatBuildSummary,
  formatDuration,
  resetAiCallReport,
  startAiCall
} from '../../src/reporting/aiCallReport.js';

describe('aiCallReport formatting', () => {
  beforeEach(() => {
    resetAiCallReport();
  });

  it('formats durations in milliseconds below one second and seconds above', () => {
    expect(formatDuration(842.4)).toBe('842ms');
    expect(formatDuration(1234)).toBe('1.23s');
  });

  it('returns no summary when no AI call ran', () => {
    expect(formatBuildSummary()).toBeUndefined();
  });

  it('summarises calls, tokens, cost, and timing for the build', () => {
    startAiCall();
    startAiCall();
    finishAiCall({
      method: 'filterAi',
      instruction: 'Keep active items',
      model: 'gpt-4.1-mini',
      outcome: 'generated',
      durationMs: 1500,
      attempts: 1,
      usage: { inputTokens: 1000, cachedInputTokens: 200, outputTokens: 100, reasoningTokens: 0 },
      costUsd: 0.0005
    });
    finishAiCall({
      method: 'someAi',
      instruction: 'Match any item with a unit price above 100 dollars.',
      model: 'gpt-4.1-mini',
      outcome: 'cached',
      durationMs: 3,
      attempts: 0,
      costUsd: 0
    });

    const summary = formatBuildSummary();

    expect(summary).toContain('calls      2 · generated 1 · cached 1 · failed 0');
    expect(summary).toContain('models     gpt-4.1-mini');
    expect(summary).toContain('tokens     in 1000 (200 cached) · out 100 · reasoning 0');
    expect(summary).toContain('cost       $0.000500');
    expect(summary).toContain('slowest    1.50s · filterAi(): "Keep active items"');
  });

  it('marks cost as partial when a priced model is missing pricing data', () => {
    startAiCall();
    finishAiCall({
      method: 'filterAi',
      instruction: 'Keep active items',
      model: 'unknown-model',
      outcome: 'generated',
      durationMs: 10,
      attempts: 1,
      usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, reasoningTokens: 0 }
    });

    expect(formatBuildSummary()).toContain('cost       $0.000000 (partial: some models have no pricing data)');
  });
});
