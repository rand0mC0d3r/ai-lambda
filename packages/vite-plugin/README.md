# vite-plugin-ai-lambda

[![npm version](https://img.shields.io/npm/v/vite-plugin-ai-lambda.svg)](https://www.npmjs.com/package/vite-plugin-ai-lambda)
[![npm downloads](https://img.shields.io/npm/dm/vite-plugin-ai-lambda.svg)](https://www.npmjs.com/package/vite-plugin-ai-lambda)
[![license](https://img.shields.io/npm/l/vite-plugin-ai-lambda.svg)](#license)
[![Vite 6+](https://img.shields.io/badge/vite-%3E%3D6-646CFF.svg)](https://vite.dev)
[![TypeScript 7](https://img.shields.io/badge/typescript-7.x-3178C6.svg)](https://www.typescriptlang.org)

Turn plain-English instructions into array operations at **Vite transform time**.

Write `sortAi`, `filterAi`, `findAi`, `mapAi`, or `reduceAi`. The plugin asks OpenAI to generate a small JavaScript function during `vite` or `vite build`, validates it, and rewrites your call to a native array method. The browser never calls OpenAI.

```ts
const cheapestFirst = products.sortAi('Sort by price, lowest first.');
```

```js
// What the app actually ships
const cheapestFirst = products.toSorted((a, b) => a.price - b.price);
```

## Table of contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Usage](#usage)
- [API reference](#api-reference)
- [Supported types and helpers](#supported-types-and-helpers)
- [How it works](#how-it-works)
- [Caching](#caching)
- [Security model](#security-model)
- [Known limitations](#known-limitations)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)
- [Metrics](#metrics)
- [Test coverage](#test-coverage)
- [Development](#development)
- [Contributing](#contributing)
- [Reporting security issues](#reporting-security-issues)
- [License](#license)

## Features

- **Natural-language array methods**: `sortAi`, `filterAi`, `findAi`, `mapAi`, and `reduceAi`.
- **Zero runtime AI cost**: the output is plain JavaScript; no AI code ships to the browser.
- **Build-time generation** during both `vite` (dev server) and `vite build`.
- **Persistent cache** of generated functions, so repeat builds make no API calls.
- **Resilient OpenAI calls**: 60-second timeout, and automatic retries with backoff for network errors, 408, 429, and 5xx responses (honoring `Retry-After`).
- **Type-aware**: field schemas are inferred from your `tsconfig.json` through TypeScript's compiler API.
- **Validated output**: generated code must pass a restricted grammar before it is used.
- **Chainable**: combine AI methods with each other and with native array methods.
- **Actionable errors**: failures name the call site, instruction, cause, and a suggested fix.
- **Small footprint**: one runtime dependency (`magic-string`), no telemetry.

## Requirements

| Requirement | Version |
|---|---|
| Vite | `>=6.0.0` (peer dependency) |
| TypeScript | `>=7.0.2 <8.0.0` (peer dependency, installed in your project) |
| OpenAI | API key and network access when a function must be generated |
| Runtime | Browsers or Node.js with `Array.prototype.toSorted` (or a polyfill) for `sortAi` |

The plugin uses TypeScript's **unstable** synchronous compiler API (`typescript/unstable/sync`), which is why TypeScript is pinned to the 7.x range.

## Installation

```sh
npm install -D vite-plugin-ai-lambda typescript vite
```

## Quick start

**1. Register the plugin** in `vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import { aiCompiler } from 'vite-plugin-ai-lambda';

export default defineConfig({
  plugins: [aiCompiler()]
});
```

**2. Add `.ai-rc.json`** next to `tsconfig.json` in your Vite project root:

```json
{
  "apiKey": "YOUR_OPENAI_API_KEY",
  "model": "gpt-4.1-mini",
  "cache": true,
  "generatedDir": ".ai-cache"
}
```

**3. Keep secrets and the cache out of version control:**

```gitignore
.ai-rc.json
.ai-cache/
```

**4. (Optional) Enable the array method types** if your `vite.config.ts` is excluded from your app's TypeScript project, add a `.d.ts` file included by your `tsconfig.json`:

```ts
/// <reference types="vite-plugin-ai-lambda" />
```

## Configuration

Create `.ai-rc.json` in the resolved Vite root (the `root` option, or the directory Vite runs in).

| Option | Type | Default | Description |
|---|---|---|---|
| `apiKey` | `string` | none (**required**) | OpenAI API key. Checked at startup, even when every function is cached. |
| `model` | `string` | `"gpt-4.1-mini"` | Model used for generation. It must support structured JSON output. |
| `cache` | `boolean` | `true` | When `true`, generated functions are read from and written to `generatedDir`. `false` skips both. |
| `generatedDir` | `string` | `".ai-cache"` | Cache directory, relative to the Vite root. |

Only `apiKey` is required. The key is read only from `.ai-rc.json`; there is no environment-variable fallback.

The file is validated at startup. The plugin fails the build if the file is not a JSON object, contains keys other than the four above (so typos are caught), or has a value of the wrong type. `generatedDir` must be a relative path that stays inside the Vite root.

## Usage

Every instruction **must be a string literal**. Methods chain with each other and with native array methods.

| Method | Compiles to | Generated function |
|---|---|---|
| `sortAi(instruction)` | `toSorted` | Comparator `(a, b)` |
| `filterAi(instruction)` | `filter` | Predicate `(item)` |
| `findAi(instruction)` | `find` | Predicate `(item)` |
| `mapAi(instruction)` | `map` | Mapper `(item)` |
| `reduceAi(instruction, initialValue)` | `reduce` | Reducer `(acc, item)` |

```ts
const cheapestFirst = products.sortAi('Sort by price, lowest first.');

const available = products.filterAi('Keep only items that are in stock.');

const firstAvailable = products.findAi('Find the first item that is in stock.');

const discounted = products.mapAi(
  'Reduce price by 10%, rounded to two decimals, and keep every other field.'
);

const total = products.reduceAi(
  'Add each item price multiplied by its quantity to the running total.',
  0
);
```

### Chaining

```ts
const revenue = orders
  .filterAi('Keep completed orders only.')
  .sortAi('Sort by total from highest to lowest.')
  .reduceAi<number>('Add each order total to the running revenue.', 0);
```

### Type arguments

- `sortAi` returns a new array because it compiles to `toSorted`; the input is not mutated.
- `mapAi<U>` and `reduceAi<U>` accept a type argument that describes the result to TypeScript. When `U` is an object type, the plugin checks the generated function at build time: every declared required field must be provided, and object literal keys must be declared in `U`. Value types are not verified, and scalar and array results are not checked.
- For an empty array, pass an explicit type so `reduceAi` knows the accumulator type:

```ts
const selected = products.reduceAi<Product[]>(
  'Return a new array containing products with a price above 50.',
  []
);
```

## API reference

The package augments the global `Array<T>` interface with these methods (declared in `dist/ai-macros.d.ts`):

```ts
interface Array<T> {
  sortAi(instruction: string): T[];
  filterAi(instruction: string): T[];
  findAi(instruction: string): T | undefined;
  mapAi<U = T>(instruction: string): U[];
  reduceAi<U>(instruction: string, initialValue: U): U;
}
```

| Export | Kind | Description |
|---|---|---|
| `aiCompiler()` | function | Returns the Vite plugin. Call it with no arguments; configuration comes from `.ai-rc.json` and `tsconfig.json`. |
| `AIConfig` | type | Shape of `.ai-rc.json`: `apiKey`, `model`, `cache`, `generatedDir`. |

## Supported types and helpers

The TypeScript checker supports arrays of objects with simple scalar fields:

| TypeScript field type | Inferred schema |
|---|---|
| `string` | `string` |
| `number` | `number` |
| `boolean` | `boolean` |
| `Date` | `date` |

Nested objects, unsupported field types, and mixed unions (such as `string | number`) are rejected at build time with an error naming the field.

Generated code must be an **expression-bodied arrow function** with the expected parameter names. Only these helpers are allowed:

| Method | Allowed helpers |
|---|---|
| `sortAi` | `localeCompare` |
| `filterAi` | `localeCompare`, `includes` |
| `findAi` | `localeCompare`, `includes` |
| `mapAi` | `localeCompare`, `includes`, `Math.round`, `Math.floor`, `Math.ceil` |
| `reduceAi` | `localeCompare`, `includes`, `Math.round`, `Math.floor`, `Math.ceil` |

## How it works

```mermaid
flowchart TD
    A["Vite starts"] --> B["Load tsconfig.json and .ai-rc.json"]
    B --> C["Transform matching JS/TS module"]
    C --> D["Find supported AI method calls"]
    D --> E["TypeScript checker infers receiver and accumulator schemas"]
    E --> F{"Generated function in cache?"}
    F -- Yes --> H["Validate function"]
    F -- No --> G["Send instruction and schema to OpenAI"]
    G --> H
    H --> I["Cache function when enabled"]
    I --> J["Rewrite to toSorted, filter, map, or reduce"]
    J --> K["Application runs native JavaScript"]
```

1. On startup, the plugin loads `tsconfig.json` and `.ai-rc.json` and verifies the API key.
2. For each `.js`, `.jsx`, `.ts`, or `.tsx` module (excluding `node_modules`), it finds supported AI calls.
3. The TypeScript checker infers the element schema of the receiver array (and the accumulator type for `reduceAi`).
4. On a cache miss, the instruction, the inferred schema, and the method's rules are sent to OpenAI's Responses API (`https://api.openai.com/v1/responses`). **Array contents are never sent.**
5. The generated function is validated, cached (if enabled), and the call is rewritten.
6. Each generation is logged through Vite's logger: the instruction when it starts, and the generated function when it finishes. Identical concurrent generations share one OpenAI request.

If generation or validation fails, the transform fails. The plugin never leaves an uncompiled AI call in the output.

For a detailed diagram of where the plugin attaches to Vite's hooks and plugin order, see [docs/architecture.md](./docs/architecture.md).

## Caching

Generated functions are stored as JSON files in `generatedDir`, named by a hash of:

- the instruction,
- the inferred schema,
- the model,
- the plugin's compiler version,
- parameter schemas (for `reduceAi`, the accumulator's schema).

Changing any of these triggers regeneration. Cached files contain the generated JavaScript, so you can review them directly.

**Ignore the cache** (default, recommended for most projects) or **commit it** if you want CI builds to run without OpenAI access or cost. Committing it means reviewing new cache files in pull requests like any other code.

To force regeneration, delete the relevant file in `.ai-cache/` or the whole directory.

Cache writes are atomic (written to a temporary file, then renamed), so an interrupted build does not leave a partial file. If a cached file is unreadable or invalid, the plugin logs a warning and regenerates it.

## Security model

- **Your API key** lives in `.ai-rc.json`. Never commit it.
- **Your data** stays local: only the instruction and the type schema leave your machine, and only on a cache miss.
- **Generated code is validated, not sandboxed.** The validator rejects computed or optional access, accessor definitions, prototype-related properties, shorthand or computed object keys, loose equality, coercive arithmetic, `this`/`super`, unknown identifiers, undeclared fields, and calls outside each method's helper list. Object spread is limited to object parameters and array spread to array parameters.
- **Validation is not a JavaScript sandbox.** Reading or spreading application data can still invoke getters or proxy traps on those objects. Review generated behavior and runtime data as you would any application code.
- **No telemetry.** The only network call is the OpenAI request on a cache miss.

## Known limitations

- Only arrays of objects with `string`, `number`, `boolean`, or `Date` fields are supported. Nested objects and mixed unions are not.
- `mapAi<U>` and `reduceAi<U>` object results are checked for required and undeclared keys at build time only. Field value types are not verified, and scalar and array results are not checked.
- The API key is only read from `.ai-rc.json`; there is no environment-variable fallback.
- The key is required even when every function is cached.
- `sortAi` needs `Array.prototype.toSorted` at runtime (or a polyfill).
- Output quality depends on the model and the instruction. Ambiguous instructions may fail validation; simplify them and retry.
- The TypeScript integration uses an unstable API, so the TypeScript peer range is pinned to 7.x.

## Troubleshooting

Configuration and transform errors are prefixed with `[ai-compile-time]`.

| Symptom | Check |
|---|---|
| Missing config or API key | Put `.ai-rc.json` at the resolved Vite root and set `apiKey`. The key is required even for cache hits. |
| TypeScript config error | Ensure a valid `tsconfig.json` is at the same root. |
| `items must be an array` | Check that the expression before the AI method has an array type in the project's TypeScript program. |
| `Unable to type-check AI call` / `source does not match the TypeScript project` | Make sure the file is included in `tsconfig.json`, and that no other plugin rewrites the source before this one runs. |
| Unsupported field type | Use `string`, `number`, `boolean`, or `Date` fields; avoid mixed unions and nested objects. |
| Invalid invocation | Pass a literal string; `reduceAi` also needs an initial value. Type arguments are supported only on `mapAi` and `reduceAi`. |
| `Invalid cached ...` warning | The plugin regenerates the entry automatically. If it keeps happening, delete the file in `generatedDir`. |
| `OpenAI error 401` / `429` / `5xx` | Verify the key and model access (401). For 429 and 5xx, the plugin already retried; check quota and rate limits, or retry the build later. |
| `OpenAI request failed after N attempt(s)` | Check connectivity and proxy settings. The plugin already retried, and each request times out after 60 seconds. |
| Generation refused or validation error | Simplify the instruction to supported fields and helpers, then retry. |
| `sortAi` missing at runtime | Confirm the plugin is registered and the call is in a transformed JS/TS module. Check `toSorted` support too. |

Errors include the failing call site, instruction, model, underlying cause, and a suggested next step. Configuration errors identify the resolved Vite root and expected config files.

## FAQ

**Does my array data go to OpenAI?**
No. Only the instruction and the inferred field schema are sent, and only when a function is not cached.

**Is the same instruction always compiled the same way?**
The cache makes the output stable across builds. A fresh generation may differ, so commit the cache or review the generated file if you need a fixed result.

**Can I see the generated code?**
Yes. Open the JSON file in `.ai-cache/`. The transformed source also contains the native method call.

**Does it work in production builds?**
Yes. Functions are generated at build time, and the shipped bundle contains only native JavaScript.

**Why does `sortAi` return a new array?**
It compiles to `toSorted`, which does not mutate the input.

**Can I use it with `filterAi`, `mapAi`, and `reduceAi` without a generic?**
Yes. The generic is optional. Use it when you need a specific result type for `mapAi` or an empty-array `reduceAi`.

## Metrics

Measured on version `0.2.2` (2026-11-01).

| Metric | Value |
|---|---|
| Version | `0.2.2` |
| Runtime dependencies | 1 (`magic-string` 1.4.5) |
| Peer dependencies | `vite >=6.0.0`, `typescript >=7.0.2 <8.0.0` |
| Source files | 14 TypeScript files, 1,716 lines |
| Test files | 6 test files, 50 tests, 870 lines of test code |
| Test run time | ~1.6 s |
| Published package | 34 files, 19.2 kB packed, 88.7 kB unpacked |
| License | ISC |

## Test coverage

Coverage is measured with [Vitest](https://vitest.dev) and V8 (`npm run test:coverage`). The configured thresholds are 80% for branches, functions, lines, and statements, enforced per file.

**Configured scope** (the modules listed in `vitest.config.ts`):

| Metric | Coverage | Covered / total |
|---|---|---|
| Statements | **91.56%** | 293 / 320 |
| Branches | **84.61%** | 297 / 351 |
| Functions | **100%** | 40 / 40 |
| Lines | **92.25%** | 286 / 310 |

**Per file:**

| File | Statements | Branches | Functions | Lines |
|---|---|---|---|---|
| `aiCompiler.ts` | 97.29% | 87.50% | 100% | 97.29% |
| `functions/inferSchema.ts` | 89.28% | 80.00% | 100% | 88.46% |
| `functions/validateAiFunction.ts` | 85.45% | 81.05% | 100% | 86.11% |
| `openai/extractGeneratedText.ts` | 95.83% | 91.66% | 100% | 100% |
| `openai/generateAiFunction.ts` | 97.05% | 84.61% | 100% | 97.05% |
| `transform/transformModule.ts` | 96.49% | 95.91% | 100% | 98.18% |

**Across all of `src/`** (includes modules outside the configured scope):

| Metric | Coverage | Covered / total |
|---|---|---|
| Statements | 90.78% | 335 / 369 |
| Branches | 83.45% | 333 / 399 |
| Functions | 100% | 46 / 46 |
| Lines | 91.36% | 328 / 359 |

Not included in the configured thresholds: `errorContext.ts` (75.86% statements, 75.55% branches). Adding it to `vitest.config.ts` is a good next step.

## Development

This package is a workspace of the [ai-lambda](https://github.com/rand0mC0d3r/ai-lambda) repository. From the repository root:

```sh
npm install
npm test                 # run unit tests (all workspaces)
npm run test:coverage    # run tests with coverage report
```

From this package directory (`packages/vite-plugin`):

```sh
npm run build            # compile src/ to dist/ with tsc
npm test                 # vitest run
npm run test:coverage    # vitest run --coverage (HTML report in coverage/)
npm pack --dry-run       # inspect what will be published
```

### Project layout

```text
src/
  aiCompiler.ts           Vite plugin entry point
  ai-macros.ts            Global Array method declarations
  aiFunctions.ts          AIFunctionSpec type for method specs
  constants.ts            Defaults and per-method specs
  errorContext.ts         Error decoration with cause and insight
  utils.ts                Record guard and SHA-256 hashing for cache keys
  functions/              Schema inference and generated-function validation
  openai/                 OpenAI request and response parsing
  transform/              Module scanning and call rewriting
  translations/en.ts      User-facing messages
test/                     Vitest suites mirroring src/
```

## Contributing

Contributions are welcome.

1. Open an issue first for larger changes so the approach can be agreed.
2. Create a branch and keep changes focused.
3. Add or update tests for behavior changes. Run `npm test` and `npm run build` before opening a pull request.
4. Keep the validator strict: new helpers or syntax need tests that show why they are safe.
5. Update this README when user-facing behavior, configuration, or metrics change.

Commit messages follow the [Conventional Commits](https://www.conventionalcommits.org) style used in this repository (`feat:`, `fix:`, `refactor:`, `docs:`).

## Reporting security issues

Please do not open a public issue for a vulnerability, especially one involving the validator, generated code execution, or API key handling. Report it privately through [GitHub security advisories](https://github.com/rand0mC0d3r/ai-lambda/security/advisories/new).

## License

[ISC](https://opensource.org/licenses/ISC)
