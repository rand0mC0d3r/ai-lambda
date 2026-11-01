# 🤖 AI Lambda

**AI Lambda is a Vite + TypeScript demo of compile-time, natural-language array operations.** Describe a sort, filter, or transformation in a string, and the Vite plugin asks OpenAI to generate a small JavaScript function during development or build. The generated function replaces the AI call before the app runs in the browser.

```ts
const expensiveFirst = cart.sortAi(
  'Sort by unit price, highest first.'
);
```

This is a compiler experiment and example app—not a general-purpose runtime AI SDK. The browser does not call OpenAI when these operations run.

## ✨ What it demonstrates

- `sortAi`, `filterAi`, and `mapAi` array operations written as natural-language instructions.
- TypeScript-based inference of the array item schema.
- Build-time generation and validation of simple JavaScript functions.
- Local caching of generated functions.
- Pipelines that combine AI-generated and ordinary JavaScript array operations.

## 🚀 Quick start

### Requirements

- Node.js and npm (use a Node version supported by the installed Vite release).
- An OpenAI API key.

### Install and configure

```sh
npm ci
```

Create a local `.ai-rc.json` in the project root:

```json
{
  "apiKey": "YOUR_OPENAI_API_KEY",
  "model": "gpt-4.1-mini",
  "cache": true,
  "generatedDir": ".ai-cache"
}
```

`.ai-rc.json` is excluded from Git. Keep your real API key in this local file; never paste it into source code or commit it. The API key is required in the config, while a cache miss causes the plugin to send a request to OpenAI.

Only `apiKey` is required. The defaults are `gpt-4.1-mini` for `model`, `true` for `cache`, and `.ai-cache` for `generatedDir`.

### Run the demo

```sh
npm run dev
```

Open the local URL printed by Vite. Try the pipeline buttons above the shopping cart to compare different operation sequences.

```sh
npm run build
npm run preview
```

`build` type-checks with TypeScript and creates the production site in `dist/`; `preview` serves that build locally.

## 🧩 How it works

1. The Vite plugin scans project TypeScript and JavaScript for calls named `sortAi`, `filterAi`, or `mapAi`.
2. TypeScript infers the item fields and supported field types from the array expression.
3. On a cache miss, the plugin sends the instruction and inferred schema to OpenAI. **It does not send the array's runtime items.**
4. The generated function is validated and, by default, stored under `.ai-cache/`.
5. The AI call is rewritten to a native array operation. The resulting app runs that generated JavaScript—not an AI request—in the browser.

For example:

```ts
items.sortAi('Sort by price, lowest first.');
```

is compiled to the equivalent of:

```ts
items.toSorted((a, b) => a.price - b.price);
```

The exact comparator is generated from your instruction and the inferred schema.

## 🛠️ The three operations

All instructions must be **string literals** and each AI method takes exactly one argument.

### Sort: `sortAi`

Describe the ordering rule. `sortAi` compiles to `toSorted`, so it returns a sorted copy rather than mutating the original array.

```ts
const byPrice = products.sortAi(
  'Sort by price, lowest first.'
);

const byNaturalName = products.sortAi(
  'Sort by product name in natural alphabetical order.'
);

const byLineTotal = cart.sortAi(
  'Sort by quantity multiplied by unit price, highest first. When totals tie, sort product names alphabetically.'
);
```

### Filter: `filterAi`

Describe which items to keep. The generated predicate compiles to native `filter`.

```ts
const available = products.filterAi(
  'Keep only items that are in stock.'
);

const affordableAccessories = products.filterAi(
  'Keep accessories with a unit price under 50 dollars.'
);
```

### Map: `mapAi`

Describe the output item. Use a TypeScript generic when you want to specify the result type; preserve fields explicitly if they should remain in the output.

```ts
const discounted = products.mapAi(
  'Apply a 10% discount to unitPrice, rounded to two decimals, and keep every other field.'
);

interface ProductSummary {
  name: string;
  priceLabel: string;
}

const summaries = products.mapAi<ProductSummary>(
  'Return an object with name copied from product and priceLabel set to the unit price rounded to two decimals as a string.'
);
```

`mapAi` compiles to native `map`. The generated mapper is checked against the input schema; use a clear instruction and a result type that matches the generated object.

## 🔗 Compose operations

AI methods can be chained with one another and with native array methods. Calls run from left to right, so changing their order can change the result.

```ts
const saleItems = cart
  .mapAi(
    'Apply a 10% discount to unitPrice, rounded to two decimals, and keep all other fields.'
  )
  .filterAi(
    'Keep only items that are in stock and have a unit price above 5 dollars.'
  )
  .sortAi(
    'Sort by total line price (quantity multiplied by unit price), highest first.'
  );
```

Compare filtering before and after the discount:

```ts
// The threshold is evaluated against the original unitPrice.
const filterThenDiscount = cart
  .filterAi('Keep items with a unit price above 10 dollars.')
  .mapAi('Reduce unitPrice by 10% and keep all other fields.');

// The threshold is evaluated against the discounted unitPrice.
const discountThenFilter = cart
  .mapAi('Reduce unitPrice by 10% and keep all other fields.')
  .filterAi('Keep items with a unit price above 10 dollars.');
```

The repository's demo offers more combinations—including native `filter`, `toSorted`, and `toReversed` alongside AI operations—in [`src/pipelines.ts`](./src/pipelines.ts).

## ⚖️ AI methods vs. native methods

| Need | AI method | Native method |
|---|---|---|
| Sort by a rule stated in domain language | `items.sortAi('Sort by total price, highest first.')` | Write a comparator such as `items.toSorted((a, b) => b.total - a.total)` |
| Keep items described by a business rule | `items.filterAi('Keep in-stock items below $20.')` | Write a predicate such as `items.filter((item) => item.inStock && item.price < 20)` |
| Transform fields from a natural-language request | `items.mapAi('Apply a 10% discount and keep all fields.')` | Write the transformation explicitly in `items.map(...)` |
| Predictable, simple logic with no generation step | Not necessary | Prefer native methods |
| Logic that benefits from a natural-language specification | Convenient during development/build | Translate the rule into ordinary JavaScript yourself |

| AI-generated operation | Native replacement | Mutates the input? |
|---|---|---|
| `sortAi(instruction)` | `toSorted(comparator)` | No |
| `filterAi(instruction)` | `filter(predicate)` | No |
| `mapAi(instruction)` | `map(mapper)` | No |

Prefer native array methods for rules that are straightforward to express in code. AI methods add generation and an OpenAI dependency to development/build; they are useful here for demonstrating how a natural-language rule can become a typed, inspectable function.

## 📐 Supported input schema

The compiler derives the item schema from the array expression. The supported field types are:

| TypeScript field | Inferred type |
|---|---|
| `string` | `string` |
| `number` | `number` |
| `boolean` | `boolean` |
| `Date` | `date` |

For example:

```ts
interface CartItem {
  product: string;
  quantity: number;
  unitPrice: number;
  addedAt: Date;
  inStock: boolean;
}
```

Generated code is restricted to simple expression-bodied arrow functions and schema fields. The configured operations also allow a small set of methods: `localeCompare` and `includes` for string logic, and `Math.round`, `Math.floor`, and `Math.ceil` for mapping. Use fields with consistent supported types; nested or otherwise unsupported field types are not currently handled.

## 🧠 Cache and API behavior

- Caching is enabled by default and stores generated functions in `.ai-cache/`.
- The cache key uses the instruction, inferred schema, and model, so a change to any of these can trigger generation again.
- Set `"cache": false` to request a fresh generated function instead of reading or writing the cache.
- A request is made during Vite development/build on a cache miss for a matching operation.
- The Vite plugin still requires a configured API key even when a cache entry exists.
- The API receives the instruction and field schema—not the array's runtime data.

## 🗂️ Project layout

| Path | Purpose |
|---|---|
| [`vite.config.ts`](./vite.config.ts) | Registers the AI compiler plugin with Vite |
| [`vite/aiCompiler.ts`](./vite/aiCompiler.ts) | Finds AI calls, infers types, and rewrites calls |
| [`vite/openai/`](./vite/openai/) | Requests and extracts generated functions |
| [`vite/comparator/`](./vite/comparator/) | Infers schemas and validates generated functions |
| [`src/ai-macros.d.ts`](./src/ai-macros.d.ts) | Declares the AI methods for TypeScript |
| [`src/pipelines.ts`](./src/pipelines.ts) | Demo pipelines with AI and native array methods |
| [`src/cart.ts`](./src/cart.ts) | Sample typed cart data |

## ⚠️ Current limitations

- AI instructions must be literal strings so the compiler can read them before runtime.
- The plugin only recognizes the supported method names in project `.js`, `.jsx`, `.ts`, and `.tsx` files; it skips `node_modules`.
- Input schemas currently support string, number, boolean, and `Date` fields, not arbitrary nested structures.
- Generated functions are deliberately limited; they are not general-purpose JavaScript.
- The API key and network access are needed for generation. A browser-only runtime cannot generate missing functions.
- This repository has no dedicated test script; `npm run build` runs the configured TypeScript check and Vite production build.

## 📄 License

ISC. See the [`package.json`](./package.json) for project metadata.
