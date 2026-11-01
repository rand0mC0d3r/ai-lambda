import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: path.dirname(fileURLToPath(import.meta.url)),
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      include: [
        'src/aiCompiler.ts',
        'src/comparator/inferSchema.ts',
        'src/comparator/validateAiFunction.ts',
        'src/openai/extractGeneratedText.ts',
        'src/openai/generateAiFunction.ts',
        'src/utils.ts'
      ],
      reporter: ['text', 'html'],
      thresholds: {
        perFile: true,
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80
      }
    }
  }
});
