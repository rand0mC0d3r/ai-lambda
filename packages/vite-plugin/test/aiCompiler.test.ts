import { afterEach, describe, expect, it, vi } from 'vitest';
import { aiCompiler } from '../src/aiCompiler.js';
import * as generation from '../src/openai/generateAiFunction.js';
import { aiFunctionSpecs } from '../src/aiFunctions.js';
import {
  callConfigResolved,
  callTransform,
  createProject
} from './helpers.js';

const methods = `
interface Product {
  name: string;
  price: number;
  active: boolean;
}
interface Array<T> {
  sortAi(instruction: string): T[];
  filterAi(instruction: string): T[];
  mapAi<U = T>(instruction: string): U[];
  reduceAi<U>(instruction: string, initialValue: U): U;
}
const products: Product[] = [];
`;

const generatedFunctions: Record<string, string> = {
  sort: '(a, b) => a.price - b.price',
  filter: '(item) => item.active',
  map: '(item) => ({...item})',
  reduce: '(acc, item) => acc + item.price'
};

describe('aiCompiler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function initializedPlugin(
    source: string,
    config: Record<string, unknown> = { apiKey: 'test-key' }
  ) {
    const project = await createProject(source, config);
    const plugin = aiCompiler();
    await callConfigResolved(plugin, project.root);
    return { ...project, plugin };
  }

  function mockGeneration() {
    vi.spyOn(generation, 'generateAiFunction').mockImplementation(
      async (_config, _root, spec) => generatedFunctions[spec.kind]
    );
  }

  it('transforms chained operations and preserves generic and reducer arguments', async () => {
    mockGeneration();
    const source = `${methods}
const result = products
  .filterAi('active')
  .sortAi('price')
  .mapAi<{ name: string }>('copy')
  .reduceAi<number>('count', 0);
`;
    const { plugin, sourcePath, cleanup } = await initializedPlugin(source);

    try {
      const transformed = await callTransform(plugin, source, sourcePath);

      expect(transformed).toEqual({
        code: expect.stringContaining(
          '.filter((item) => item.active).toSorted((a, b) => a.price - b.price).map<{ name: string }>((item) => ({...item})).reduce<number>((acc, item) => acc + item.price, 0)'
        ),
        map: expect.objectContaining({
          version: 3,
          sources: [sourcePath],
          sourcesContent: [source],
          mappings: expect.stringMatching(/./)
        })
      });
      expect(generation.generateAiFunction).toHaveBeenCalledTimes(4);
      expect(generation.generateAiFunction).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        aiFunctionSpecs.filterAi,
        'active',
        { name: 'string', price: 'number', active: 'boolean' },
        expect.anything(),
        undefined
      );
    } finally {
      plugin.closeBundle?.call(plugin);
      await cleanup();
    }
  });

  it('infers date fields and scalar, object, and array accumulator schemas', async () => {
    mockGeneration();
    const source = `
interface Product {
  name: string;
  price: number;
  createdAt: Date;
  note?: string;
}
interface Summary {
  total: number;
  label: string;
}
interface Array<T> {
  filterAi(instruction: string): T[];
  reduceAi<U>(instruction: string, initialValue: U): U;
}
const products: Product[] = [];
const filtered = products.filterAi('recent');
const scalarArray = products.reduceAi<number[]>('prices', []);
const objectArray = products.reduceAi<Product[]>('products', []);
const summary = products.reduceAi<Summary>('summary', { total: 0, label: '' });
`;
    const { plugin, sourcePath, cleanup } = await initializedPlugin(source);

    try {
      await callTransform(plugin, source, sourcePath);

      expect(generation.generateAiFunction).toHaveBeenNthCalledWith(
        1,
        expect.anything(),
        expect.any(String),
        aiFunctionSpecs.filterAi,
        'recent',
        {
          name: 'string',
          price: 'number',
          createdAt: 'date',
          note: 'string'
        },
        expect.anything(),
        undefined
      );
      expect(generation.generateAiFunction).toHaveBeenNthCalledWith(
        2,
        expect.anything(),
        expect.any(String),
        aiFunctionSpecs.reduceAi,
        'prices',
        expect.objectContaining({ price: 'number' }),
        expect.anything(),
        {
          acc: { kind: 'array', elementType: 'number' },
          item: {
            kind: 'object',
            fields: expect.objectContaining({ price: 'number' })
          }
        }
      );
      expect(generation.generateAiFunction).toHaveBeenNthCalledWith(
        3,
        expect.anything(),
        expect.any(String),
        aiFunctionSpecs.reduceAi,
        'products',
        expect.anything(),
        expect.anything(),
        {
          acc: {
            kind: 'array',
            elementType: 'object',
            elementFields: expect.objectContaining({ name: 'string' })
          },
          item: {
            kind: 'object',
            fields: expect.objectContaining({ name: 'string' })
          }
        }
      );
      expect(generation.generateAiFunction).toHaveBeenNthCalledWith(
        4,
        expect.anything(),
        expect.any(String),
        aiFunctionSpecs.reduceAi,
        'summary',
        expect.anything(),
        expect.anything(),
        {
          acc: {
            kind: 'object',
            fields: { total: 'number', label: 'string' }
          },
          item: {
            kind: 'object',
            fields: expect.objectContaining({ name: 'string' })
          }
        }
      );
    } finally {
      plugin.closeBundle?.call(plugin);
      await cleanup();
    }
  });

  it('returns null for unrelated paths, file types, and source without AI methods', async () => {
    const plugin = aiCompiler();
    expect(await callTransform(plugin, 'const x = 1', '/project/node_modules/x.js')).toBeNull();
    expect(await callTransform(plugin, 'const x = 1', '/project/file.json')).toBeNull();
    expect(await callTransform(plugin, 'const x = 1', '/project/file.ts')).toBeNull();
  });

  it('returns null when the method name is not a property access call', async () => {
    const source = `${methods}
const result = products['sortAi']('price');
`;
    const { plugin, sourcePath, cleanup } = await initializedPlugin(source);

    try {
      expect(await callTransform(plugin, source, sourcePath)).toBeNull();
    } finally {
      plugin.closeBundle?.call(plugin);
      await cleanup();
    }
  });

  it('rejects non-literal instructions and incorrect argument counts', async () => {
    const invalidSources = [
      `${methods} const instruction = 'price'; const result = products.sortAi(instruction);`,
      `${methods} const result = products.sortAi('price', 'extra');`,
      `${methods} const result = products.reduceAi('total');`,
      `${methods} const result = products.filterAi<{ name: string }>('active');`
    ];

    for (const source of invalidSources) {
      const { plugin, sourcePath, cleanup } = await initializedPlugin(source);

      try {
        await expect(callTransform(plugin, source, sourcePath)).rejects.toThrow(
          'Invalid'
        );
      } finally {
        plugin.closeBundle?.call(plugin);
        await cleanup();
      }
    }
  });

  it('rejects unsupported item fields and mismatched project source', async () => {
    const source = `interface Item { value: string | number }
interface Array<T> { filterAi(instruction: string): T[] }
const items: Item[] = [];
const result = items.filterAi('keep');
`;
    const { plugin, sourcePath, cleanup } = await initializedPlugin(source);
    mockGeneration();

    try {
      await expect(callTransform(plugin, source, sourcePath)).rejects.toThrow(
        'Unsupported filterAi() field type for "value"'
      );
      await expect(
        callTransform(plugin, source.replace('keep', 'different'), sourcePath)
      ).rejects.toThrow('source does not match the TypeScript project');
    } finally {
      plugin.closeBundle?.call(plugin);
      await cleanup();
    }
  });

  it('requires project configuration and a configured API key', async () => {
    const missingKey = await createProject(`${methods} const x = 1;`, {});
    try {
      await expect(
        callConfigResolved(aiCompiler(), missingKey.root)
      ).rejects.toThrow('Missing OpenAI API key');
    } finally {
      await missingKey.cleanup();
    }

    const plugin = aiCompiler();
    await expect(
      callTransform(plugin, 'const x = 1', '/project/test.ts')
    ).resolves.toBeNull();
    await expect(
      callTransform(plugin, `${methods} products.sortAi('price')`, '/project/test.ts')
    ).rejects.toThrow('TypeScript API is not initialized');
  });

  it('releases the TypeScript API on watcher shutdown', async () => {
    const { plugin, cleanup } = await initializedPlugin(`${methods} const x = 1;`);

    try {
      plugin.closeWatcher?.call(plugin);
      await expect(
        callTransform(plugin, `${methods} products.sortAi('price')`, '/project/other.ts')
      ).rejects.toThrow('TypeScript API is not initialized');
    } finally {
      await cleanup();
    }
  });
});
