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
 * Computes a SHA-256 hex digest, used to build cache file names.
 *
 * @param value The text to hash.
 * @returns The lowercase hex digest.
 */
export function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
