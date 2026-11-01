import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { API } from 'typescript/unstable/sync';
import { createLogger } from 'vite';
import { aiFunctionSpecs } from '../../src/constants.js';
import { hash } from '../../src/utils.js';
import type { AIConfig } from '../../src/types.js';
import type { ExpectedResult } from '../../src/aiFunctions.js';
import { generateAiFunction } from '../../src/openai/generateAiFunction.js';
import { resetAiCallReport } from '../../src/reporting/aiCallReport.js';

const config: AIConfig = {
  provider: 'openai',
  apiKey: 'test-key',
  model: 'test-model',
  cache: true,
  generatedDir: '.cache'
};
const schema = { active: 'boolean' };
const instruction = 'Keep active items';
const expectedResult: ExpectedResult = {
  parameters: { item: '{ active: boolean; }' },
  result: 'boolean'
};
const cacheKey = hash(JSON.stringify({
  instruction,
  schema,
  model: config.model,
  compilerVersion: 1,
  kind: 'filter'
}));

describe('generateAiFunction semantic validation', () => {
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
    resetAiCallReport();
  });

  async function createRoot() {
    root = await mkdtemp(path.join(tmpdir(), 'ai-lambda-semantic-'));
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    return root;
  }

  function api(): API {
    const compilerApi = new API();
    apis.push(compilerApi);
    return compilerApi;
  }

  function response(payload: unknown): Response {
    return new Response(JSON.stringify(payload), { status: 200 });
  }

  function generate(projectRoot: string, cache = true) {
    return generateAiFunction(
      { ...config, cache },
      projectRoot,
      aiFunctionSpecs.filterAi,
      instruction,
      schema,
      api(),
      undefined,
      expectedResult,
      logger
    );
  }

  it('rejects a generated predicate that does not return a boolean', async () => {
    const projectRoot = await createRoot();
    fetchMock.mockResolvedValue(
      response({ output_text: JSON.stringify({ predicate: "(item) => item.active && 'yes'" }) })
    );

    await expect(generate(projectRoot)).rejects.toThrow('does not match the declared types');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('accepts a boolean predicate and caches it', async () => {
    const projectRoot = await createRoot();
    fetchMock.mockResolvedValue(
      response({ output_text: JSON.stringify({ predicate: '(item) => item.active' }) })
    );

    await expect(generate(projectRoot)).resolves.toBe('(item) => item.active');
    expect(
      await readFile(path.join(projectRoot, '.cache', `${cacheKey}.json`), 'utf8')
    ).toContain('(item) => item.active');
  });

  it('regenerates a cached predicate that fails the semantic check', async () => {
    const projectRoot = await createRoot();
    const cacheDir = path.join(projectRoot, '.cache');
    await mkdir(cacheDir, { recursive: true });
    await writeFile(
      path.join(cacheDir, `${cacheKey}.json`),
      JSON.stringify({ predicate: "(item) => item.active && 'yes'" })
    );
    fetchMock.mockResolvedValue(
      response({ output_text: JSON.stringify({ predicate: '(item) => item.active' }) })
    );
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    await expect(generate(projectRoot)).resolves.toBe('(item) => item.active');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
