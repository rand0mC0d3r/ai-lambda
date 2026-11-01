import { createHash } from 'node:crypto';

/**
 * Checks whether a value is a non-null, non-array object.
 *
 * @param value The value to check.
 * @returns `true` when the value can be read as a string-keyed record.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Converts an unknown value to a count, treating anything that is not a finite number as zero.
 *
 * @param value The raw value from a provider response.
 * @returns The number, or `0`.
 */
export function toCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Computes a SHA-256 hex digest, used to build cache file names.
 *
 * @param value The text to hash.
 * @returns The lowercase hex digest.
 */
export function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
