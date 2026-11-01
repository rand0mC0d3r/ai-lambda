import type { TokenUsage } from '../openai/usage.js';

/**
 * Final state of an AI call: new code generated, cached code reused, or failed.
 */
export type AiCallOutcome = 'generated' | 'cached' | 'failed';

/**
 * Result of one AI call, recorded for the build summary.
 */
export interface AiCallRecord {
  /** Source method name, such as `sortAi`. */
  method: string;
  /** The natural-language instruction passed to the method. */
  instruction: string;
  /** OpenAI model used for the call. */
  model: string;
  /** Whether the call generated new code, reused cached code, or failed. */
  outcome: AiCallOutcome;
  /** Wall-clock time spent on the call, in milliseconds. */
  durationMs: number;
  /** Number of HTTP attempts made. */
  attempts: number;
  /** Token usage reported by OpenAI, when available. */
  usage?: TokenUsage;
  // undefined means the model has no pricing entry.
  costUsd?: number;
  /** Failure message for calls with outcome `failed`. */
  errorMessage?: string;
}

/** Maximum number of instruction characters shown for the slowest call. */
const MAX_INSTRUCTION_PREVIEW = 60;

/** Number of AI calls started in the current build. */
let startedCalls = 0;
/** Completed call records for the current build. */
let records: AiCallRecord[] = [];
/** `performance.now()` value when the current build started. */
let buildStartedAt = performance.now();

/**
 * Clears the report state at the start of a build.
 */
export function resetAiCallReport(): void {
  startedCalls = 0;
  records = [];
  buildStartedAt = performance.now();
}

/**
 * Records that an AI call has started.
 */
export function startAiCall(): void {
  startedCalls++;
}

/**
 * Counts AI calls that have finished (generated, cached, or failed).
 *
 * @returns The number of recorded calls.
 */
export function completedAiCallCount(): number {
  return records.length;
}

/**
 * Stores the record of a finished AI call.
 *
 * @param record The call record to add.
 */
export function finishAiCall(record: AiCallRecord): void {
  records.push(record);
}

/**
 * Formats a duration in milliseconds, using seconds at or above one second.
 *
 * @param ms The duration in milliseconds.
 * @returns A string such as `850ms` or `1.25s`.
 */
export function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Formats a USD cost with six decimal places.
 *
 * @param costUsd The cost in USD, or `undefined` when unpriced.
 * @returns A string such as `$0.000123`, or `cost n/a`.
 */
export function formatCost(costUsd: number | undefined): string {
  return costUsd === undefined ? 'cost n/a' : `$${costUsd.toFixed(6)}`;
}

/**
 * Adds up token usage across call records.
 *
 * @param list The records to sum.
 * @returns The total token counts.
 */
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

/**
 * Adds up estimated cost across call records.
 *
 * @param list The records to sum.
 * @returns The total cost in USD, and whether any call with usage lacked pricing.
 */
function sumCost(list: AiCallRecord[]): { totalUsd: number; unpriced: boolean } {
  return list.reduce<{ totalUsd: number; unpriced: boolean }>(
    (sum, record) => ({
      totalUsd: sum.totalUsd + (record.costUsd ?? 0),
      unpriced: sum.unpriced || (record.costUsd === undefined && record.usage !== undefined)
    }),
    { totalUsd: 0, unpriced: false }
  );
}

/**
 * Formats token usage for one call line, including reasoning tokens when present.
 *
 * @param usage The token counts.
 * @returns A short usage description.
 */
function formatUsage(usage: TokenUsage): string {
  const reasoning = usage.reasoningTokens > 0 ? ` (reasoning ${usage.reasoningTokens})` : '';
  return `tokens in ${usage.inputTokens} (${usage.cachedInputTokens} cached) / out ${usage.outputTokens}${reasoning}`;
}

/**
 * Pluralizes the attempt count for display.
 *
 * @param attempts The number of HTTP attempts.
 * @returns `1 attempt` or `N attempts`.
 */
function attemptsLabel(attempts: number): string {
  return attempts === 1 ? '1 attempt' : `${attempts} attempts`;
}

/**
 * Builds the log line printed under an AI call in the build output.
 *
 * @param record The finished call.
 * @returns The formatted line, prefixed with `↳`.
 */
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

/**
 * Builds the multi-line summary of all AI calls in the current build.
 *
 * @returns The summary text, or `undefined` when no AI calls were started.
 */
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
