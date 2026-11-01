import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readAiConfig } from '../src/config.js';

describe('readAiConfig', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'ai-lambda-config-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function readSource(source: string): Promise<unknown> {
    const configPath = path.join(root, '.ai-rc.json');
    await writeFile(configPath, source);
    return readAiConfig(configPath, root);
  }

  async function read(config: unknown): Promise<unknown> {
    return readSource(JSON.stringify(config));
  }

  it('applies defaults when only apiKey is set', async () => {
    await expect(read({ apiKey: 'test-key' })).resolves.toEqual({
      provider: 'openai',
      apiKey: 'test-key',
      model: 'gpt-4.1-mini',
      cache: true,
      generatedDir: '.ai-cache'
    });
  });

  it('accepts explicit valid values', async () => {
    await expect(
      read({
        apiKey: 'test-key',
        model: 'gpt-4.1',
        cache: false,
        generatedDir: 'nested/.ai-cache'
      })
    ).resolves.toEqual({
      provider: 'openai',
      apiKey: 'test-key',
      model: 'gpt-4.1',
      cache: false,
      generatedDir: 'nested/.ai-cache'
    });
  });

  it('accepts a generatedDir whose name starts with two dots', async () => {
    await expect(
      read({ apiKey: 'test-key', generatedDir: '..cache' })
    ).resolves.toMatchObject({ generatedDir: '..cache' });
  });

  it('rejects config files that are not valid JSON', async () => {
    await expect(readSource('{ "apiKey": ')).rejects.toThrow(
      '.ai-rc.json is not valid JSON'
    );
  });

  it.each([
    ['null', 'null'],
    ['an array', '[]'],
    ['a string', '"key"']
  ])('rejects a config file that is %s', async (_label, source) => {
    await expect(readSource(source)).rejects.toThrow(
      '.ai-rc.json must contain a JSON object'
    );
  });

  it('rejects unknown keys so typos are not silently ignored', async () => {
    await expect(
      read({ apiKey: 'test-key', generatedDIR: '.cache' })
    ).rejects.toThrow('Unknown key(s) in .ai-rc.json: generatedDIR');
  });

  it.each([
    [{}, 'Missing OpenAI API key'],
    [{ apiKey: '' }, 'apiKey in .ai-rc.json must be a non-empty string'],
    [{ apiKey: '   ' }, 'apiKey in .ai-rc.json must be a non-empty string'],
    [{ apiKey: 42 }, 'apiKey in .ai-rc.json must be a non-empty string'],
    [{ apiKey: null }, 'apiKey in .ai-rc.json must be a non-empty string'],
    [{ apiKey: 'k', model: '' }, 'model in .ai-rc.json must be a non-empty string'],
    [{ apiKey: 'k', model: 7 }, 'model in .ai-rc.json must be a non-empty string'],
    [{ apiKey: 'k', cache: 'yes' }, 'cache in .ai-rc.json must be true or false'],
    [{ apiKey: 'k', cache: null }, 'cache in .ai-rc.json must be true or false'],
    [{ apiKey: 'k', generatedDir: '' }, 'generatedDir in .ai-rc.json must be a relative path'],
    [{ apiKey: 'k', generatedDir: 3 }, 'generatedDir in .ai-rc.json must be a relative path'],
    [{ apiKey: 'k', generatedDir: '../outside' }, 'generatedDir in .ai-rc.json must be a relative path'],
    [{ apiKey: 'k', generatedDir: 'a/../../outside' }, 'generatedDir in .ai-rc.json must be a relative path'],
    [{ apiKey: 'k', generatedDir: '..' }, 'generatedDir in .ai-rc.json must be a relative path'],
    [{ apiKey: 'k', generatedDir: '.' }, 'generatedDir in .ai-rc.json must be a relative path'],
    [{ apiKey: 'k', generatedDir: '/tmp/cache' }, 'generatedDir in .ai-rc.json must be a relative path'],
    [{ apiKey: 'k', provider: 'mistral' }, 'provider in .ai-rc.json must be one of: openai, anthropic, gemini, openai-compatible'],
    [{ apiKey: 'k', provider: 'anthropic' }, 'model in .ai-rc.json is required when provider is anthropic'],
    [{ apiKey: 'k', provider: 'gemini' }, 'model in .ai-rc.json is required when provider is gemini'],
    [{ apiKey: 'k', provider: 'openai-compatible', model: 'm' }, 'baseUrl in .ai-rc.json is required when provider is openai-compatible'],
    [{ apiKey: 'k', provider: 'openai-compatible', model: 'm', baseUrl: 'localhost:11434' }, 'baseUrl in .ai-rc.json must be an absolute http or https URL'],
    [{ apiKey: 'k', provider: 'anthropic', model: 'm', baseUrl: 'https://example.com' }, 'baseUrl in .ai-rc.json is only supported when provider is openai-compatible']
  ])('rejects invalid values in %j', async (config, message) => {
    await expect(read(config)).rejects.toThrow(message);
  });

  it('accepts an openai-compatible provider and strips trailing slashes from baseUrl', async () => {
    await expect(
      read({ apiKey: 'k', provider: 'openai-compatible', model: 'llama3', baseUrl: 'http://localhost:11434/v1/' })
    ).resolves.toEqual({
      provider: 'openai-compatible',
      apiKey: 'k',
      model: 'llama3',
      baseUrl: 'http://localhost:11434/v1',
      cache: true,
      generatedDir: '.ai-cache'
    });
  });

  it('allows openai-compatible without apiKey', async () => {
    await expect(
      read({ provider: 'openai-compatible', model: 'llama3', baseUrl: 'http://localhost:11434/v1' })
    ).resolves.toEqual({
      provider: 'openai-compatible',
      apiKey: '',
      model: 'llama3',
      baseUrl: 'http://localhost:11434/v1',
      cache: true,
      generatedDir: '.ai-cache'
    });
  });

  it('still requires apiKey for other providers', async () => {
    await expect(read({ provider: 'anthropic', model: 'claude' })).rejects.toThrow(
      'Missing Anthropic API key in .ai-rc.json'
    );
    await expect(read({ model: 'gpt-4.1-mini' })).rejects.toThrow('Missing OpenAI API key in .ai-rc.json');
  });

  it('rejects an empty apiKey for openai-compatible when it is set', async () => {
    await expect(read({ provider: 'openai-compatible', apiKey: '', model: 'm', baseUrl: 'http://localhost:1' })).rejects.toThrow(
      'apiKey in .ai-rc.json must be a non-empty string'
    );
  });
});
