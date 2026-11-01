import { Bench, type Task } from 'tinybench';
import { createLogger, type Plugin, type ResolvedConfig } from 'vite';
import { aiCompiler } from '../src/aiCompiler.js';
import { createProject } from '../test/helpers.js';

export { createProject };

export interface MeasureOptions {
  /** Sampling budget in milliseconds. */
  time?: number;
  /** Warmup budget in milliseconds. */
  warmupTime?: number;
}

/**
 * Times `fn` with tinybench, prints a summary table, and returns the completed task.
 * Errors thrown by `fn` fail the caller.
 */
export async function measure(
  name: string,
  fn: () => unknown,
  { time = 1000, warmupTime = 200 }: MeasureOptions = {}
): Promise<Task> {
  const bench = new Bench({ time, warmupTime, throws: true });
  bench.add(name, fn);
  await bench.run();
  console.table(bench.table());

  const task = bench.getTask(name);
  if (!task || task.result.state !== 'completed') {
    throw new Error(`Benchmark "${name}" did not complete`);
  }
  return task;
}

/** Element type and array augmentations. Declared without exports so they stay global. */
export const PRODUCT_DECLARATIONS = `
interface Product {
  name: string;
  price: number;
  active: boolean;
}
interface Array<T> {
  sortAi(instruction: string): T[];
  filterAi(instruction: string): T[];
  findAi(instruction: string): T | undefined;
  someAi(instruction: string): boolean;
}
const products: Product[] = [];
`;

/** Generated code keyed by each spec's output field, returned by the offline OpenAI stub. */
const GENERATED_CODE: Record<string, string> = {
  comparator: '(a, b) => a.price - b.price',
  predicate: '(item) => item.active'
};

const AI_METHODS = ['filterAi', 'sortAi', 'findAi', 'someAi'] as const;

/**
 * Builds a module with `count` AI array calls. Each call has a unique instruction so it
 * gets its own cache entry.
 */
export function moduleWithAiCalls(count: number): string {
  const statements = Array.from({ length: count }, (_, index) => {
    const method = AI_METHODS[index % AI_METHODS.length];
    return `const result${index} = products.${method}('Benchmark instruction ${index}');`;
  });

  return `${PRODUCT_DECLARATIONS}\n${statements.join('\n')}\n`;
}

/** Starts the plugin for a project root without logging to the console. */
export async function startPlugin(root: string): Promise<Plugin> {
  const plugin = aiCompiler();
  const hook = plugin.configResolved;

  if (!hook) throw new Error('aiCompiler has no configResolved hook');

  const handler = typeof hook === 'function' ? hook : hook.handler;
  await handler.call(plugin, {
    root,
    logger: createLogger('silent')
  } as ResolvedConfig);

  return plugin;
}

/**
 * Stub for `fetch` that answers an OpenAI Responses request with generated code. Used to
 * fill the cache before timing starts.
 */
export async function generatedCodeFetch(_url: string | URL | Request, init?: RequestInit): Promise<Response> {
  const body = JSON.parse(String(init?.body));
  const field = Object.keys(body.text.format.schema.properties)[0];
  const output = JSON.stringify({ [field]: GENERATED_CODE[field] });

  return new Response(JSON.stringify({ output_text: output }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

/** Stub for `fetch` that fails any request. Installed during timing so cache misses are visible. */
export function offlineFetch(): never {
  throw new Error('Benchmark reached the network. The generated-function cache was not warm.');
}
