# vite-plugin-ai-lambda

A Vite plugin that turns natural-language instructions on array operations
into JavaScript functions during Vite transforms. It supports `sortAi`,
`filterAi`, `mapAi`, and `reduceAi`; the generated functions are inserted into
the application bundle, so the browser does not call an AI service at runtime.

## Requirements

- Vite 6 or later.
- TypeScript 7.0.2 through 7.x, installed in the Vite project. The plugin uses
  TypeScript's unstable synchronous compiler API and the project's
  `tsconfig.json` to infer array item types.
- An OpenAI API key and network access when a matching operation needs to be
  generated.

## Install and configure

Install the plugin and its peer dependencies:

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

The Vite project root must contain both `tsconfig.json` and `.ai-rc.json`.
Configure the API key and, optionally, the generation model and cache:

```json
{
  "apiKey": "YOUR_OPENAI_API_KEY",
  "model": "gpt-4.1-mini",
  "cache": true,
  "generatedDir": ".ai-cache"
}
```

Only `apiKey` is required. The defaults are `gpt-4.1-mini`, `true`, and
`.ai-cache` for `model`, `cache`, and `generatedDir`, respectively.
`generatedDir` is resolved relative to the Vite project root.

Keep the API key and generated cache out of version control. For example:

```gitignore
.ai-rc.json
.ai-cache/
```

The API key is required when the plugin starts, even if a cached function
exists. With caching enabled, a cache hit avoids making a generation request.

Add the following declarations to a `.d.ts` file included by the project's
`tsconfig.json` so TypeScript accepts the array methods:

```ts
interface Array<T> {
  sortAi(instruction: string): T[];
  filterAi(instruction: string): T[];
  mapAi<U = T>(instruction: string): U[];
  reduceAi<U>(instruction: string, initialValue: U): U;
}
```

## Use the operations

Each method takes a string-literal instruction. `reduceAi` also takes an
initial value. The array expression is the receiver, so calls can be chained
with native methods and with the other AI methods.

### Sorting

`sortAi` generates a comparator and replaces the call with `toSorted`. It
returns a new array rather than sorting the receiver in place.

```ts
const cheapestFirst = products.sortAi(
  'Sort by price, lowest first.'
);

const naturalNameOrder = products.sortAi(
  'Sort by name in natural alphabetical order.'
);

const largestLineTotalFirst = cart.sortAi(
  'Sort by quantity multiplied by unitPrice, highest first.'
);
```

The comparator parameters are named `a` and `b`. For strings, the generated
comparator may use `localeCompare`; for numeric fields, it uses arithmetic
comparisons.

### Filtering

`filterAi` generates a predicate and replaces the call with native `filter`.
The generated predicate should return `true` for items to keep.

```ts
const available = products.filterAi(
  'Keep only items that are in stock.'
);

const affordable = products.filterAi(
  'Keep accessories with a price under 50.'
);
```

The predicate parameter is named `item`. String matching can use `includes`
or `localeCompare`.

### Mapping

`mapAi` generates a mapper and replaces the call with native `map`. The
generation instructions ask the mapper to return an object literal. Ask it to
spread the input item when unchanged fields should be retained.

```ts
const discounted = products.mapAi(
  'Reduce price by 10%, rounded to two decimals, and keep every other field.'
);

interface ProductSummary {
  name: string;
  priceLabel: string;
}

const summaries = products.mapAi<ProductSummary>(
  'Return an object with name copied from the item and priceLabel set to price rounded to two decimals as a string.'
);
```

The generic type on `mapAi` expresses the desired result type to TypeScript. The
plugin validates the generated function against the input schema, but does not
prove that its returned object satisfies that generic result type.

### Reducing

`reduceAi` generates a reducer and replaces the call with native `reduce`. The
initial value determines the accumulator and return type. The reducer receives
the current accumulator as `acc` and the current array item as `item`.

```ts
const total = products.reduceAi(
  'Add each item price multiplied by its quantity to the running total.',
  0
);

const availableTotal = products
  .filterAi('Keep only items that are in stock.')
  .reduceAi(
    'Add the price of each item to the running total.',
    0
  );
```

The initial value may be a supported scalar or an object with supported scalar
fields. For object accumulators, the generated reducer should return a new
object and spread `acc` to retain unchanged fields.

An array initial value lets the reduced result continue through native array
methods. Give an empty array an explicit generic type so the accumulator item
schema can be inferred:

```ts
const selected = products
  .filter((product) => product.inStock)
  .reduceAi<Product[]>(
    'Keep products with a price above 50; return a new array with each match appended.',
    []
  )
  .map((product) => ({
    ...product,
    price: Math.round(product.price * 90) / 100
  }))
  .filter((product) => product.price > 50);
```

Array accumulators may contain supported scalar values or objects with
supported scalar fields. Reducers must return new arrays rather than mutating
the accumulator.

## Input schema and generated functions

The plugin uses the TypeScript checker to infer the item fields from the
receiver's type. Supported field types are:

| TypeScript field type | Schema type |
|---|---|
| `string` | `string` |
| `number` | `number` |
| `boolean` | `boolean` |
| `Date` | `date` |

Use arrays of objects with simple, supported fields. Unsupported or mixed
field types (for example, a field that may be both a string and a number)
produce an error. Nested object fields and fields with other unsupported types
are not currently supported.

Generated functions must be expression-bodied arrow functions with the
expected parameter names: `(a, b)` for sorting, `(item)` for filtering and
mapping, and `(acc, item)` for reducing. They can refer to fields in the
inferred schema and use a restricted set of operations:

| Operation | Available helpers |
|---|---|
| `sortAi` | `localeCompare` |
| `filterAi` | `localeCompare`, `includes` |
| `mapAi` | `localeCompare`, `includes`, `Math.round`, `Math.floor`, `Math.ceil` |
| `reduceAi` | `localeCompare`, `includes`, `Math.round`, `Math.floor`, `Math.ceil` |

The validator rejects unsupported syntax, unknown identifiers, fields that
are not in the inferred schema, and calls outside the operation's allowed
helpers. These limits are intended for small array transformations, not
arbitrary JavaScript. Review the generated result as you would other
application code; the plugin cannot guarantee that it matches every nuance
of a natural-language instruction.

## Build-time behavior and cache

The plugin scans JavaScript and TypeScript modules (`.js`, `.jsx`, `.ts`, and
`.tsx`, excluding `node_modules`) for calls to the supported method names.
Calls are transformed during Vite development or build, not when the app is
running in the browser.

For each recognized call, the plugin:

1. Checks that the instruction is a string literal and that the call has the
   expected arguments.
2. Uses the project's TypeScript configuration to infer the receiver's item
   schema.
3. Reads a cached generated function, or sends the instruction and inferred
   schema to OpenAI on a cache miss.
4. Validates the returned function and stores it in the configured cache
   directory when caching is enabled.
5. Rewrites the AI method to `toSorted`, `filter`, `map`, or `reduce`.

The array's runtime contents are **not** sent to OpenAI. Requests contain the
instruction and inferred field schema. Generated functions are cached by
instruction, schema, and model, so changing one of these may require
regeneration. Set `"cache": false` to skip reading and writing the persistent
cache.

Because `sortAi` compiles to `toSorted`, the runtime must support
`Array.prototype.toSorted` or provide a polyfill.

## Troubleshooting

| Error or symptom | What to check |
|---|---|
| Missing `.ai-rc.json` or API key | Put `.ai-rc.json` at the resolved Vite project root and set `apiKey`. The key is required even for cache hits. |
| TypeScript configuration error | Ensure the same project root contains a valid `tsconfig.json`. The plugin uses it to infer the receiver type. |
| `items must be an array` | Check that the expression before the AI method has an array type in the project's TypeScript program. |
| Unsupported field type | Use fields typed as `string`, `number`, `boolean`, or `Date`; avoid mixed unions and nested structures. |
| Invalid invocation | Pass one string literal; `reduceAi` also needs an initial value. `mapAi` and `reduceAi` accept a generic type argument. |
| Generation or OpenAI response error | Check network access, API key validity, and the instruction. A generation failure stops the transform rather than leaving an uncompiled AI call in the output. |
| `sortAi` is missing at runtime | Confirm the Vite plugin is registered and that the call is in a transformed JS/TS module; also check runtime support for `toSorted`. |

## Limitations

- Instructions must be literal strings; runtime or variable instructions
  cannot be compiled.
- The plugin needs the project's `tsconfig.json` and `.ai-rc.json` at the
  resolved Vite root.
- Type inference supports simple scalar fields, not arbitrary nested data
  models.
- A cache miss requires network access and a working OpenAI API key during the
  Vite transform.
- Generated functions are constrained expressions, not general-purpose
  JavaScript, and their behavior may still need review.
