import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { API } from 'typescript/unstable/sync';
import { createLogger } from 'vite';
import { aiFunctionSpecs } from '../../src/constants.js';
import { hash } from '../../src/utils.js';
import type { AIConfig } from '../../src/types.js';
import { generateAiFunction } from '../../src/openai/generateAiFunction.js';
import { resetAiCallReport } from '../../src/reporting/aiCallReport.js';

vi.mock('../../src/functions/validateAiFunction.js', () => ({
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
  const logger = createLogger();
  let root: string | undefined;
  let fetchMock: ReturnType<typeof vi.fn>;
  const apis: API[] = [];

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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
      api(),
      undefined,
      undefined,
      logger
    );
    const second = await generateAiFunction(
      config,
      projectRoot,
      aiFunctionSpecs.filterAi,
      instruction,
      schema,
      api(),
      undefined,
      undefined,
      logger
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
        parameterSchemas,
        undefined,
        logger
      )
    ).resolves.toBe('(acc, item) => acc + 1');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('regenerates malformed cached functions with a warning', async () => {
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
    fetchMock.mockResolvedValue(
      response({ output_text: JSON.stringify({ predicate: '(item) => item.active' }) })
    );
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    await expect(
      generateAiFunction(
        config,
        projectRoot,
        aiFunctionSpecs.filterAi,
        instruction,
        schema,
        api(),
        undefined,
        undefined,
        logger
      )
    ).resolves.toBe('(item) => item.active');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('surfaces service errors and malformed response payloads', async () => {
    const projectRoot = await createRoot();
    fetchMock.mockImplementation(async () => new Response('upstream failed', { status: 500 }));
    await expect(
      generateAiFunction(
        config,
        projectRoot,
        aiFunctionSpecs.filterAi,
        instruction,
        schema,
        api(),
        undefined,
        undefined,
        logger
      )
    ).rejects.toThrow('OpenAI error 500: upstream failed');
    expect(fetchMock).toHaveBeenCalledTimes(3);

    fetchMock.mockResolvedValue(response({ output_text: 'not JSON' }));
    await expect(
      generateAiFunction(
        { ...config, cache: false },
        projectRoot,
        aiFunctionSpecs.filterAi,
        instruction,
        schema,
        api(),
        undefined,
        undefined,
        logger
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
        api(),
        undefined,
        undefined,
        logger
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
        api(),
        undefined,
        undefined,
        logger
      )
    ).resolves.toBe('(a, b) => 0');
    await expect(readFile(path.join(projectRoot, '.cache'))).rejects.toThrow();
  });

  it('retries rate limits and honors Retry-After', async () => {
    const projectRoot = await createRoot();
    fetchMock
      .mockResolvedValueOnce(new Response('slow down', {
        status: 429,
        headers: { 'retry-after': '0' }
      }))
      .mockResolvedValueOnce(
        response({ output_text: JSON.stringify({ predicate: '(item) => item.active' }) })
      );

    await expect(
      generateAiFunction(
        config,
        projectRoot,
        aiFunctionSpecs.filterAi,
        instruction,
        schema,
        api(),
        undefined,
        undefined,
        logger
      )
    ).resolves.toBe('(item) => item.active');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries network failures and then throws a typed network error', async () => {
    const projectRoot = await createRoot();
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    const promise = generateAiFunction(
      config,
      projectRoot,
      aiFunctionSpecs.filterAi,
      instruction,
      schema,
      api(),
      undefined,
      undefined,
      logger
    );

    await expect(promise).rejects.toMatchObject({
      code: 'openai_network',
      message: 'OpenAI request failed after 3 attempt(s): fetch failed'
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry client errors and exposes the HTTP status', async () => {
    const projectRoot = await createRoot();
    fetchMock.mockImplementation(async () => response({ error: 'bad key' }, 401));

    await expect(
      generateAiFunction(
        config,
        projectRoot,
        aiFunctionSpecs.filterAi,
        instruction,
        schema,
        api(),
        undefined,
        undefined,
        logger
      )
    ).rejects.toMatchObject({ code: 'openai_http', status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('regenerates when a cache file is unreadable JSON', async () => {
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
    await writeFile(path.join(cacheDir, `${cacheKey}.json`), '{"predicate":');
    fetchMock.mockResolvedValue(
      response({ output_text: JSON.stringify({ predicate: '(item) => item.active' }) })
    );
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    await expect(
      generateAiFunction(
        config,
        projectRoot,
        aiFunctionSpecs.filterAi,
        instruction,
        schema,
        api(),
        undefined,
        undefined,
        logger
      )
    ).resolves.toBe('(item) => item.active');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unreadable cache file'));
    expect(
      await readFile(path.join(cacheDir, `${cacheKey}.json`), 'utf8')
    ).toContain('(item) => item.active');
  });

  it('shares one request between concurrent identical generations', async () => {
    const projectRoot = await createRoot();
    fetchMock.mockImplementation(async () =>
      response({ output_text: JSON.stringify({ predicate: '(item) => item.active' }) })
    );

    const results = await Promise.all([
      generateAiFunction(config, projectRoot, aiFunctionSpecs.filterAi, instruction, schema, api(), undefined, undefined, logger),
      generateAiFunction(config, projectRoot, aiFunctionSpecs.filterAi, instruction, schema, api(), undefined, undefined, logger)
    ]);

    expect(results).toEqual(['(item) => item.active', '(item) => item.active']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('writes cache files atomically without leftover temp files', async () => {
    const projectRoot = await createRoot();
    fetchMock.mockResolvedValue(
      response({ output_text: JSON.stringify({ predicate: '(item) => item.active' }) })
    );

    await generateAiFunction(
      config,
      projectRoot,
      aiFunctionSpecs.filterAi,
      instruction,
      schema,
      api(),
      undefined,
      undefined,
      logger
    );

    const files = await readdir(path.join(projectRoot, '.cache'));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.json$/);
  });

  it('routes progress messages through the provided Vite logger', async () => {
    const projectRoot = await createRoot();
    fetchMock.mockResolvedValue(
      response({ output_text: JSON.stringify({ predicate: '(item) => item.active' }) })
    );
    const logger = createLogger();
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);

    await generateAiFunction(
      { ...config, cache: false },
      projectRoot,
      aiFunctionSpecs.filterAi,
      instruction,
      schema,
      api(),
      undefined,
      undefined,
      logger
    );

    expect(info).toHaveBeenCalledWith(expect.stringContaining('AI compiling filterAi()'));
    expect(info).toHaveBeenCalledWith(expect.stringContaining('Generated:'));
  });

  it('logs per-call model, tokens, and cost, including cache hits', async () => {
    const projectRoot = await createRoot();
    resetAiCallReport();
    fetchMock.mockResolvedValue(
      response({
        output_text: JSON.stringify({ predicate: '(item) => item.active' }),
        usage: {
          input_tokens: 1000,
          input_tokens_details: { cached_tokens: 200 },
          output_tokens: 100,
          output_tokens_details: { reasoning_tokens: 0 }
        }
      })
    );
    const logger = createLogger();
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    const modelConfig = { ...config, model: 'gpt-4.1-mini' };

    await generateAiFunction(
      modelConfig, projectRoot, aiFunctionSpecs.filterAi, instruction, schema, api(), undefined, undefined, logger
    );
    await generateAiFunction(
      modelConfig, projectRoot, aiFunctionSpecs.filterAi, instruction, schema, api(), undefined, undefined, logger
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(expect.stringContaining('gpt-4.1-mini · '));
    expect(info).toHaveBeenCalledWith(expect.stringContaining('tokens in 1000 (200 cached) / out 100'));
    expect(info).toHaveBeenCalledWith(expect.stringContaining('$0.000500'));
    expect(info).toHaveBeenCalledWith(expect.stringContaining('cache hit'));
  });
});
