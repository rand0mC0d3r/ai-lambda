import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: path.dirname(fileURLToPath(import.meta.url)),
  test: {
    include: ['bench/**/*.bench.ts'],
    // Benchmarks sample for seconds, so the default 5 s test timeout is too short.
    testTimeout: 60_000,
    // Benchmarks run one at a time so timings are not skewed by parallel work.
    fileParallelism: false
  }
});
