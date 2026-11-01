# vite-plugin-ai-lambda

A Vite plugin that compiles `sortAi`, `filterAi`, and `mapAi` array calls into
native JavaScript operations during development and production builds.

## Install

```sh
npm install -D vite-plugin-ai-lambda typescript
```

## Configure

Register the plugin in `vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import { aiCompiler } from 'vite-plugin-ai-lambda';

export default defineConfig({
  plugins: [aiCompiler()]
});
```

The Vite project must have a `tsconfig.json` and an `.ai-rc.json` in its root:

```json
{
  "apiKey": "YOUR_OPENAI_API_KEY",
  "model": "gpt-4.1-mini",
  "cache": true,
  "generatedDir": ".ai-cache"
}
```

Only `apiKey` is required. The defaults are `gpt-4.1-mini`, `true`, and
`.ai-cache`. Keep the API key in a local, ignored config file; generation
requests include the instruction and inferred item schema, not runtime array
data.

Add the array method declarations to a project TypeScript declaration file:

```ts
interface Array<T> {
  sortAi(instruction: string): T[];
  filterAi(instruction: string): T[];
  mapAi<U = T>(instruction: string): U[];
}
```

Instructions must be string literals. Calls are replaced with `toSorted`,
`filter`, or `map` before code runs. See the repository README for supported
schema types and generated-function restrictions.
