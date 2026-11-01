import type { TokenUsage } from '../openai/usage.js';

export type AiCallOutcome = 'generated' | 'cached' | 'failed';

export interface AiCallRecord {
  method: string;
  instruction: string;
  model: string;
  outcome: AiCallOutcome;
  durationMs: number;
  attempts: number;
  usage?: TokenUsage;
  // undefined means the model has no pricing entry.
  costUsd?: number;
  errorMessage?: string;
}

const MAX_INSTRUCTION_PREVIEW = 60;

let startedCalls = 0;
let records: AiCallRecord[] = [];
let buildStartedAt = performance.now();

export function resetAiCallReport(): void {
  startedCalls = 0;
  records = [];
  buildStartedAt = performance.now();
}

export function startAiCall(): void {
  startedCalls++;
}

export function completedAiCallCount(): number {
  return records.length;
}

export function finishAiCall(record: AiCallRecord): void {
  records.push(record);
}

export function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

export function formatCost(costUsd: number | undefined): string {
  return costUsd === undefined ? 'cost n/a' : `$${costUsd.toFixed(6)}`;
}

function sumUsage(list: AiCallRecord[]): TokenUsage {
  return list.reduce<TokenUsage>(
    (sum, record) => ({
      inputTokens: sum.inputTokens + (record.usage?.inputTokens ?? 0),
      cachedInputTokens: sum.cachedInputTokens + (record.usage?.cachedInputTokens ?? 0),
      outputTokens: sum.outputTokens + (record.usage?.outputTokens ?? 0),
      reasoningTokens: sum.reasoningTokens + (record.usage?.reasoningTokens ?? 0)
    }),
    { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 }
  );
}

function sumCost(list: AiCallRecord[]): { totalUsd: number; unpriced: boolean } {
  return list.reduce<{ totalUsd: number; unpriced: boolean }>(
    (sum, record) => ({
      totalUsd: sum.totalUsd + (record.costUsd ?? 0),
      unpriced: sum.unpriced || (record.costUsd === undefined && record.usage !== undefined)
    }),
    { totalUsd: 0, unpriced: false }
  );
}

function formatUsage(usage: TokenUsage): string {
  const reasoning = usage.reasoningTokens > 0 ? ` (reasoning ${usage.reasoningTokens})` : '';
  return `tokens in ${usage.inputTokens} (${usage.cachedInputTokens} cached) / out ${usage.outputTokens}${reasoning}`;
}

function attemptsLabel(attempts: number): string {
  return attempts === 1 ? '1 attempt' : `${attempts} attempts`;
}

export function formatCallLine(record: AiCallRecord): string {
  const duration = formatDuration(record.durationMs);

  if (record.outcome === 'cached') {
    return `↳ cache hit · ${duration} · no API call`;
  }

  if (record.outcome === 'failed') {
    const parts = [`failed after ${duration}`, attemptsLabel(record.attempts)];
    if (record.usage) parts.push(formatUsage(record.usage), formatCost(record.costUsd));
    if (record.errorMessage) parts.push(record.errorMessage);
    return `↳ ${parts.join(' · ')}`;
  }

  const parts = [record.model, duration, attemptsLabel(record.attempts)];
  if (record.usage) parts.push(formatUsage(record.usage));
  parts.push(formatCost(record.costUsd));
  return `↳ ${parts.join(' · ')}`;
}

export function formatBuildSummary(): string | undefined {
  if (startedCalls === 0) return undefined;

  const usage = sumUsage(records);
  const apiRecords = records.filter((record) => record.outcome !== 'cached');
  const apiMs = apiRecords.reduce((sum, record) => sum + record.durationMs, 0);
  const slowest = apiRecords.reduce<AiCallRecord | undefined>(
    (current, record) => (!current || record.durationMs > current.durationMs ? record : current),
    undefined
  );
  const { totalUsd, unpriced } = sumCost(records);
  const models = [...new Set(records.map((record) => record.model))].join(', ');
  const countOf = (outcome: AiCallOutcome) => records.filter((record) => record.outcome === outcome).length;

  const lines = [
    '📊 AI compile summary',
    `   calls      ${startedCalls} · generated ${countOf('generated')} · cached ${countOf('cached')} · failed ${countOf('failed')}`,
    `   models     ${models || 'n/a'}`,
    `   tokens     in ${usage.inputTokens} (${usage.cachedInputTokens} cached) · out ${usage.outputTokens} · reasoning ${usage.reasoningTokens}`,
    `   cost       ${formatCost(totalUsd)}${unpriced ? ' (partial: some models have no pricing data)' : ''}`,
    `   time       API ${formatDuration(apiMs)} · build ${formatDuration(performance.now() - buildStartedAt)}`
  ];

  if (slowest) {
    const preview = slowest.instruction.length > MAX_INSTRUCTION_PREVIEW
      ? `${slowest.instruction.slice(0, MAX_INSTRUCTION_PREVIEW - 1)}…`
      : slowest.instruction;
    lines.push(`   slowest    ${formatDuration(slowest.durationMs)} · ${slowest.method}(): "${preview}"`);
  }

  return lines.join('\n');
}
