# vite-plugin-ai-lambda

Turn plain-English instructions into array operations at Vite transform time. Write `sortAi`, `filterAi`, `mapAi`, or `reduceAi`; the plugin generates and validates a small JavaScript function, then swaps your call for a native array method. No AI request happens in the browser. ✨

## 🚀 Get started

### Requirements

- Vite 6 or later.
- TypeScript `>=7.0.2 <8.0.0`, installed in your Vite project. The plugin uses TypeScript's unstable synchronous compiler API to infer types from your `tsconfig.json`.
- An OpenAI API key and network access when a function needs to be generated.

### Install

```sh
npm install -D vite-plugin-ai-lambda typescript vite
```

Register the plugin in `vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import { aiCompiler } from 'vite-plugin-ai-lambda';

export default defineConfig({
  plugins: [aiCompiler()]
});
```

Add `.ai-rc.json` and `tsconfig.json` to your Vite project root:

```json
{
  "apiKey": "YOUR_OPENAI_API_KEY",
  "model": "gpt-4.1-mini",
  "cache": true,
  "generatedDir": ".ai-cache"
}
```

Only `apiKey` is required. The defaults are `gpt-4.1-mini`, `true`, and `.ai-cache` for `model`, `cache`, and `generatedDir`. The generated directory is relative to the Vite root.

Keep the key and generated cache out of version control:

```gitignore
.ai-rc.json
.ai-cache/
```

The key is checked when the plugin starts, even if every generated function is cached. A cache hit does skip the OpenAI request.

### Tell TypeScript about the methods

Add this declaration to a `.d.ts` file included by your project's `tsconfig.json`:

```ts
interface Array<T> {
  sortAi(instruction: string): T[];
  filterAi(instruction: string): T[];
  mapAi<U = T>(instruction: string): U[];
  reduceAi<U>(instruction: string, initialValue: U): U;
}
```

## 🧠 Use it

Every instruction must be a string literal. The methods can be chained with native array methods and with each other.

| Method | Compiles to | Generated function |
|---|---|---|
| `sortAi(instruction)` | `toSorted` | Comparator `(a, b)` |
| `filterAi(instruction)` | `filter` | Predicate `(item)` |
| `mapAi(instruction)` | `map` | Mapper `(item)` |
| `reduceAi(instruction, initialValue)` | `reduce` | Reducer `(acc, item)` |

```ts
const cheapestFirst = products.sortAi('Sort by price, lowest first.');

const available = products.filterAi('Keep only items that are in stock.');

const discounted = products.mapAi(
  'Reduce price by 10%, rounded to two decimals, and keep every other field.'
);

const total = products.reduceAi(
  'Add each item price multiplied by its quantity to the running total.',
  0
);
```

`sortAi` returns a new array because it compiles to `toSorted`. For `mapAi`, a generic type argument expresses the desired TypeScript result type, but the plugin does not prove that the generated object matches it. `reduceAi` infers its accumulator from the initial value; use an explicit generic for an empty array so its element type is available:

```ts
const selected = products.reduceAi<Product[]>(
  'Return a new array containing products with a price above 50.',
  []
);
```

## ⚙️ How it works

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

The plugin scans `.js`, `.jsx`, `.ts`, and `.tsx` modules, excluding `node_modules`. The array's runtime contents are **not** sent to OpenAI; a cache miss sends the instruction and inferred schema. Generated functions are keyed by instruction, schema, and model, so changing one can trigger regeneration. Set `"cache": false` to skip persistent cache reads and writes.

## 🛡️ What generated code can do

The TypeScript checker supports arrays of objects with simple scalar fields:

| TypeScript field | Inferred schema |
|---|---|
| `string` | `string` |
| `number` | `number` |
| `boolean` | `boolean` |
| `Date` | `date` |

Nested objects, unsupported field types, and fields with mixed types (such as `string | number`) are not supported. Generated functions must be expression-bodied arrow functions with the expected parameter names.

| Method | Allowed helpers |
|---|---|
| `sortAi` | `localeCompare` |
| `filterAi` | `localeCompare`, `includes` |
| `mapAi` | `localeCompare`, `includes`, `Math.round`, `Math.floor`, `Math.ceil` |
| `reduceAi` | `localeCompare`, `includes`, `Math.round`, `Math.floor`, `Math.ceil` |

The validator accepts a restricted expression grammar: it rejects computed or optional access, accessor definitions, prototype-related properties, shorthand/computed object keys, loose equality, coercive arithmetic, unknown identifiers, undeclared fields, and calls outside each method's declared helpers. Object spread is limited to object parameters, and array spread to array parameters. This validation is **not a JavaScript sandbox**: reading or spreading application data can invoke getters or proxy traps on those objects. Review generated behavior and the runtime data as you would any application code. `sortAi` also requires runtime support for `Array.prototype.toSorted` or a polyfill.

## 🔧 Troubleshooting

| Symptom | Check |
|---|---|
| Missing config or API key | Put `.ai-rc.json` at the resolved Vite root and set `apiKey`. The key is required even for cache hits. |
| TypeScript config error | Ensure a valid `tsconfig.json` is at the same root. |
| `items must be an array` | Check that the expression before the AI method has an array type in the project's TypeScript program. |
| Unsupported field type | Use `string`, `number`, `boolean`, or `Date` fields; avoid mixed unions and nested objects. |
| Invalid invocation | Pass a literal string; `reduceAi` also needs an initial value. Generic type arguments are supported for `mapAi` and `reduceAi`. |
| Generation or OpenAI error | Check network access, API key validity, and the instruction. A failed generation stops the transform; it will not leave an uncompiled AI call in the output. |
| `sortAi` missing at runtime | Confirm the plugin is registered and the call is in a transformed JS/TS module. Check `toSorted` support too. |

## 🧪 Run tests

From this package directory:

```sh
npm test
npm run test:coverage
```
