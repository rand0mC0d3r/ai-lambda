import { defineConfig } from 'vite';
import { aiCompiler } from './vite/aiCompiler.ts';

export default defineConfig({
  plugins: [aiCompiler()]
});
