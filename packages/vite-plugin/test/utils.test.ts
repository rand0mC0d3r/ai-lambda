import { describe, expect, it } from 'vitest';
import { hash, isRecord } from '../src/utils.js';

describe('utility functions', () => {
  it('recognizes non-null objects as records', () => {
    expect(isRecord({ value: 1 })).toBe(true);
    expect(isRecord([])).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord('value')).toBe(false);
  });

  it('hashes strings deterministically with SHA-256', () => {
    expect(hash('value')).toBe(
      'cd42404d52ad55ccfa9aca4adc828aa5800ad9d385a0671fbcbf724118320619'
    );
    expect(hash('value')).toBe(hash('value'));
    expect(hash('other')).not.toBe(hash('value'));
  });
});
