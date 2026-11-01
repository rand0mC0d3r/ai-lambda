import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { API } from 'typescript/unstable/sync';
import { aiFunctionSpecs } from '../src/constants.js';
import { hash } from '../src/utils.js';
import type { AIConfig } from '../src/types.js';
import { generateAiFunction } from '../src/openai/generateAiFunction.js';

vi.mock('../src/comparator/validateAiFunction.js', () => ({
  validateAiFunction: vi.fn()
}));

const config: AIConfig = {
  apiKey: 'test-key',
  model: 'test-model',
  cache: true,
  generatedDir: '.cache'
};
const schema = { active: 'boolean' };
const instruction = 'Keep active items';

describe('generateAiFunction', () => {
  let root: string | undefined;
  let fetchMock: ReturnType<typeof vi.fn>;
  const apis: API[] = [];

  afterEach(async () => {
    vi.unstubAllGlobals();
    for (const compilerApi of apis) compilerApi.close();
    apis.length = 0;
    if (root) await rm(root, { recursive: true, force: true });
    root = undefined;
  });

  async function createRoot() {
    root = await mkdtemp(path.join(tmpdir(), 'ai-lambda-generate-'));
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    return root;
  }

  function api(): API {
    const compilerApi = new API();
    apis.push(compilerApi);
    return compilerApi;
  }

  function response(payload: unknown, status = 200): Response {
    return new Response(JSON.stringify(payload), { status });
  }

  it('generates, validates, writes, then reuses a cached function', async () => {
    const projectRoot = await createRoot();
    fetchMock.mockResolvedValue(
      response({ output_text: JSON.stringify({ predicate: '(item) => item.active' }) })
    );

    const first = await generateAiFunction(
      config,
      projectRoot,
      aiFunctionSpecs.filterAi,
      instruction,
      schema,
      api()
    );
    const second = await generateAiFunction(
      config,
      projectRoot,
      aiFunctionSpecs.filterAi,
      instruction,
      schema,
      api()
    );

    expect(first).toBe('(item) => item.active');
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(request.model).toBe('test-model');
    expect(request.input).toContain(instruction);
    expect(
      await readFile(
        path.join(
          projectRoot,
          '.cache',
          `${hash(JSON.stringify({
            instruction,
            schema,
            model: config.model,
            compilerVersion: 1,
            kind: 'filter'
          }))}.json`
        ),
        'utf8'
      )
    ).toContain('(item) => item.active');
  });

  it('uses cache identity for reducer accumulator schemas', async () => {
    const projectRoot = await createRoot();
    const parameterSchemas = {
      acc: { kind: 'scalar' as const, type: 'number' },
      item: { kind: 'object' as const, fields: schema }
    };
    const cacheKey = hash(JSON.stringify({
      instruction,
      schema,
      model: config.model,
      compilerVersion: 1,
      parameterSchemas,
      kind: 'reduce'
    }));
    await mkdir(path.join(projectRoot, '.cache'), { recursive: true });
    await writeFile(
      path.join(projectRoot, '.cache', `${cacheKey}.json`),
      JSON.stringify({ reducer: '(acc, item) => acc + 1' })
    );

    await expect(
      generateAiFunction(
        config,
        projectRoot,
        aiFunctionSpecs.reduceAi,
        instruction,
        schema,
        api(),
        parameterSchemas
      )
    ).resolves.toBe('(acc, item) => acc + 1');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects malformed cached functions', async () => {
    const projectRoot = await createRoot();
    const cacheKey = hash(JSON.stringify({
      instruction,
      schema,
      model: config.model,
      compilerVersion: 1,
      kind: 'filter'
    }));
    const cacheDir = path.join(projectRoot, '.cache');
    await mkdir(cacheDir, { recursive: true });
    await writeFile(path.join(cacheDir, `${cacheKey}.json`), '{"predicate":2}');

    await expect(
      generateAiFunction(
        config,
        projectRoot,
        aiFunctionSpecs.filterAi,
        instruction,
        schema,
        api()
      )
    ).rejects.toThrow('Invalid cached predicate');
  });

  it('surfaces service errors and malformed response payloads', async () => {
    const projectRoot = await createRoot();
    fetchMock.mockResolvedValue(new Response('upstream failed', { status: 500 }));
    await expect(
      generateAiFunction(
        config,
        projectRoot,
        aiFunctionSpecs.filterAi,
        instruction,
        schema,
        api()
      )
    ).rejects.toThrow('OpenAI error 500: upstream failed');

    fetchMock.mockResolvedValue(response({ output_text: 'not JSON' }));
    await expect(
      generateAiFunction(
        { ...config, cache: false },
        projectRoot,
        aiFunctionSpecs.filterAi,
        instruction,
        schema,
        api()
      )
    ).rejects.toThrow('OpenAI returned invalid predicate JSON');

    fetchMock.mockResolvedValue(response({ output_text: '{"predicate":2}' }));
    await expect(
      generateAiFunction(
        { ...config, cache: false },
        projectRoot,
        aiFunctionSpecs.filterAi,
        instruction,
        schema,
        api()
      )
    ).rejects.toThrow('OpenAI response is missing a predicate string');
  });

  it('skips cache writes when caching is disabled', async () => {
    const projectRoot = await createRoot();
    fetchMock.mockResolvedValue(
      response({ output_text: JSON.stringify({ comparator: '(a, b) => 0' }) })
    );

    await expect(
      generateAiFunction(
        { ...config, cache: false },
        projectRoot,
        aiFunctionSpecs.sortAi,
        instruction,
        schema,
        api()
      )
    ).resolves.toBe('(a, b) => 0');
    await expect(readFile(path.join(projectRoot, '.cache'))).rejects.toThrow();
  });
});
