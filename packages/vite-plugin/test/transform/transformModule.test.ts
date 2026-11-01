import { afterEach, describe, expect, it, vi } from 'vitest';
import { aiCompiler } from '../../src/aiCompiler.js';
import * as generation from '../../src/openai/generateAiFunction.js';
import { aiFunctionSpecs } from '../../src/constants.js';
import {
  callCloseBundle,
  callConfigResolved,
  callTransform,
  createProject
} from '../helpers.js';

const methods = `
interface Product {
  name: string;
  price: number;
  active: boolean;
}
interface Array<T> {
  sortAi(instruction: string): T[];
  filterAi(instruction: string): T[];
  findAi(instruction: string): T | undefined;
  mapAi<U = T>(instruction: string): U[];
  reduceAi<U>(instruction: string, initialValue: U): U;
}
const products: Product[] = [];
`;

const generatedFunctions: Record<string, string> = {
  sort: '(a, b) => a.price - b.price',
  filter: '(item) => item.active',
  find: '(item) => item.name.includes("pro")',
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
        undefined,
        undefined,
        expect.anything()
      );
    } finally {
      callCloseBundle(plugin);
      await cleanup();
    }
  });

  it('rewrites findAi to find and passes the find spec to generation', async () => {
    mockGeneration();
    const source = `${methods}
const first = products.filterAi('active').findAi('pro product');
`;
    const { plugin, sourcePath, cleanup } = await initializedPlugin(source);

    try {
      const transformed = await callTransform(plugin, source, sourcePath);

      expect(transformed).toEqual({
        code: expect.stringContaining(
          '.filter((item) => item.active).find((item) => item.name.includes("pro"))'
        ),
        map: expect.objectContaining({ version: 3 })
      });
      expect(generation.generateAiFunction).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        aiFunctionSpecs.findAi,
        'pro product',
        { name: 'string', price: 'number', active: 'boolean' },
        expect.anything(),
        undefined,
        undefined,
        expect.anything()
      );
    } finally {
      callCloseBundle(plugin);
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
        undefined,
        undefined,
        expect.anything()
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
        },
        undefined,
        expect.anything()
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
        },
        undefined,
        expect.anything()
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
        },
        { fields: { total: 'number', label: 'string' }, optionalFields: [] },
        expect.anything()
      );
    } finally {
      callCloseBundle(plugin);
      await cleanup();
    }
  });

  it('returns null for unrelated paths, file types, and source without AI methods', async () => {
    const plugin = aiCompiler();
    expect(await callTransform(plugin, 'const x = 1', '/project/node_modules/x.js')).toBeNull();
    expect(await callTransform(plugin, 'const x = 1', '/project/file.json')).toBeNull();
    expect(await callTransform(plugin, 'const x = 1', '/project/file.ts')).toBeNull();
    expect(await callTransform(plugin, 'const x = 1', '\0virtual.ts')).toBeNull();
  });

  it('returns null when the method name is not a property access call', async () => {
    const source = `${methods}
const result = products['sortAi']('price');
`;
    const { plugin, sourcePath, cleanup } = await initializedPlugin(source);

    try {
      expect(await callTransform(plugin, source, sourcePath)).toBeNull();
    } finally {
      callCloseBundle(plugin);
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
        callCloseBundle(plugin);
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
      callCloseBundle(plugin);
      await cleanup();
    }
  });

  it('adds call-site details and actionable guidance to compilation errors', async () => {
    const source = `${methods}
const result = products.filterAi('keep active items');
`;
    const { plugin, sourcePath, cleanup } = await initializedPlugin(source);
    vi.spyOn(generation, 'generateAiFunction').mockRejectedValue(
      new Error('Forbidden property access: privateField')
    );
    const callOffset = source.indexOf('products.filterAi');
    const callLine = source.slice(0, callOffset).split('\n').length;
    const callColumn =
      callOffset - source.lastIndexOf('\n', callOffset - 1);

    try {
      await expect(callTransform(plugin, source, sourcePath)).rejects.toMatchObject({
        message: expect.stringContaining(
          `Failed to compile filterAi() in ${sourcePath}:${callLine}:${callColumn}`
        ),
        cause: expect.objectContaining({
          message: 'Forbidden property access: privateField'
        })
      });
      await expect(callTransform(plugin, source, sourcePath)).rejects.toThrow(
        'Insight: The generated function did not meet the plugin’s validation rules'
      );
    } finally {
      callCloseBundle(plugin);
      await cleanup();
    }
  });

});
