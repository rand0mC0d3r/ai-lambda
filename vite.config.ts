import { defineConfig } from 'vite';
import { aiCompiler } from 'vite-plugin-ai-lambda';

export default defineConfig({
  plugins: [aiCompiler()]
});
