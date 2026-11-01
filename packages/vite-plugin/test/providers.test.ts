import type { Logger } from 'vite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProvider, type GenerationRequest } from '../src/providers/index.js';
import type { AIConfig } from '../src/types.js';

const request: GenerationRequest = {
  instructions: 'Generate a predicate.',
  input: JSON.stringify({ instruction: 'Keep active items' }),
  schemaName: 'generate_function',
  outputField: 'generated'
};

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function sentBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

function sentHeaders(fetchMock: ReturnType<typeof vi.fn>): Record<string, string> {
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return init.headers as Record<string, string>;
}

describe('Anthropic provider', () => {
  const config: AIConfig = {
    provider: 'anthropic',
    apiKey: 'anthropic-key',
    model: 'claude-test',
    cache: true,
    generatedDir: '.cache'
  };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () =>
      jsonResponse({
        content: [
          { type: 'text', text: 'ignored' },
          {
            type: 'tool_use',
            name: 'generate_function',
            input: { generated: '(item) => item.active' }
          }
        ],
        usage: {
          input_tokens: 10,
          cache_read_input_tokens: 2,
          cache_creation_input_tokens: 3,
          output_tokens: 5
        }
      })
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('forces a tool call and returns the tool input as JSON text', async () => {
    const trace = { attempts: 0 } as { attempts: number; usage?: unknown };
    const output = await createProvider(config).generate(request, trace as never, logger);

    expect(JSON.parse(output)).toEqual({ generated: '(item) => item.active' });
    expect(trace.attempts).toBe(1);
    expect(trace.usage).toEqual({
      inputTokens: 15,
      cachedInputTokens: 2,
      outputTokens: 5,
      reasoningTokens: 0
    });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(sentHeaders(fetchMock)).toMatchObject({
      'x-api-key': 'anthropic-key',
      'anthropic-version': '2023-06-01'
    });

    const body = sentBody(fetchMock);
    expect(body).toMatchObject({
      model: 'claude-test',
      system: 'Generate a predicate.',
      tool_choice: { type: 'tool', name: 'generate_function' }
    });
    expect(body.tools).toEqual([
      expect.objectContaining({ name: 'generate_function' })
    ]);
  });

  it('reports a provider_http error with the Anthropic label', async () => {
    fetchMock.mockImplementation(async () => new Response('bad key', { status: 401 }));
    const trace = { attempts: 0 } as never;

    await expect(createProvider(config).generate(request, trace, logger))
      .rejects.toMatchObject({ code: 'provider_http', status: 401 });
    await expect(createProvider(config).generate(request, trace, logger))
      .rejects.toThrow('Anthropic');
  });

  it('reports provider_response when no tool_use block is returned', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ content: [], stop_reason: 'max_tokens' }));

    await expect(createProvider(config).generate(request, { attempts: 0 } as never, logger))
      .rejects.toMatchObject({ code: 'provider_response' });
  });
});

describe('Gemini provider', () => {
  const config: AIConfig = {
    provider: 'gemini',
    apiKey: 'gemini-key',
    model: 'gemini-2.0-flash',
    cache: true,
    generatedDir: '.cache'
  };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () =>
      jsonResponse({
        candidates: [
          {
            content: {
              parts: [
                { text: 'thinking', thought: true },
                { text: '{"generated":"(item) => item.active"}' }
              ]
            },
            finishReason: 'STOP'
          }
        ],
        usageMetadata: {
          promptTokenCount: 7,
          candidatesTokenCount: 3,
          thoughtsTokenCount: 2,
          cachedContentTokenCount: 1
        }
      })
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls generateContent with a JSON response schema and skips thought parts', async () => {
    const trace = { attempts: 0 } as { attempts: number; usage?: unknown };
    const output = await createProvider(config).generate(request, trace as never, logger);

    expect(output).toBe('{"generated":"(item) => item.active"}');
    expect(trace.usage).toEqual({
      inputTokens: 7,
      cachedInputTokens: 1,
      outputTokens: 5,
      reasoningTokens: 2
    });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent'
    );
    expect(sentHeaders(fetchMock)).toMatchObject({ 'x-goog-api-key': 'gemini-key' });

    const body = sentBody(fetchMock) as {
      systemInstruction: { parts: { text: string }[] };
      generationConfig: { responseMimeType: string; responseSchema: unknown };
    };
    expect(body.systemInstruction.parts[0].text).toBe('Generate a predicate.');
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.responseSchema).toEqual({
      type: 'OBJECT',
      properties: { generated: { type: 'STRING' } },
      required: ['generated']
    });
  });

  it('reports the block reason when no text is returned', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ candidates: [], promptFeedback: { blockReason: 'SAFETY' } })
    );

    await expect(createProvider(config).generate(request, { attempts: 0 } as never, logger))
      .rejects.toThrow('block=SAFETY');
  });
});

describe('OpenAI-compatible provider', () => {
  const config: AIConfig = {
    provider: 'openai-compatible',
    apiKey: 'local-key',
    model: 'local-model',
    baseUrl: 'http://localhost:11434/v1',
    cache: true,
    generatedDir: '.cache'
  };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () =>
      jsonResponse({
        choices: [
          {
            message: { role: 'assistant', content: '{"generated":"(item) => true"}' },
            finish_reason: 'stop'
          }
        ],
        usage: {
          prompt_tokens: 4,
          completion_tokens: 6,
          prompt_tokens_details: { cached_tokens: 1 },
          completion_tokens_details: { reasoning_tokens: 2 }
        }
      })
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts a chat completion to the configured base URL with a JSON schema', async () => {
    const trace = { attempts: 0 } as { attempts: number; usage?: unknown };
    const output = await createProvider(config).generate(request, trace as never, logger);

    expect(output).toBe('{"generated":"(item) => true"}');
    expect(trace.usage).toEqual({
      inputTokens: 4,
      cachedInputTokens: 1,
      outputTokens: 6,
      reasoningTokens: 2
    });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('http://localhost:11434/v1/chat/completions');
    expect(sentHeaders(fetchMock)).toMatchObject({ Authorization: 'Bearer local-key' });

    const body = sentBody(fetchMock);
    expect(body).toMatchObject({
      model: 'local-model',
      messages: [
        { role: 'system', content: 'Generate a predicate.' },
        { role: 'user', content: request.input }
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'generate_function', strict: true }
      }
    });
  });

  it('omits the Authorization header when no apiKey is configured', async () => {
    const keyless: AIConfig = { ...config, apiKey: '' };

    await createProvider(keyless).generate(request, { attempts: 0 } as never, logger);

    expect(sentHeaders(fetchMock)).not.toHaveProperty('Authorization');
  });

  it('reports a refusal returned in the message', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        choices: [{ message: { content: null, refusal: 'not allowed' }, finish_reason: 'stop' }]
      })
    );

    await expect(createProvider(config).generate(request, { attempts: 0 } as never, logger))
      .rejects.toThrow('refused AI function generation: not allowed');
  });

  it('reports the finish reason when the message has no content', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ choices: [{ message: { content: '' }, finish_reason: 'length' }] })
    );

    await expect(createProvider(config).generate(request, { attempts: 0 } as never, logger))
      .rejects.toThrow('(reason=length)');
  });
});
