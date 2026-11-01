import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { API } from 'typescript/unstable/sync';
import path from 'node:path';
import { createLogger, type Logger } from 'vite';
import type {
  AIFunctionParameterSchema,
  AIFunctionSpec,
  ResultShape
} from '../aiFunctions.js';
import {
  COMPILER_VERSION,
  OPENAI_MAX_RETRIES,
  OPENAI_MAX_RETRY_AFTER_MS,
  OPENAI_RESPONSES_URL,
  OPENAI_RETRY_BASE_DELAY_MS,
  OPENAI_TIMEOUT_MS
} from '../constants.js';
import { AIPluginError } from '../errors.js';
import { validateAiFunction } from '../functions/validateAiFunction.js';
import type { AIConfig } from '../types.js';
import { hash, isRecord } from '../utils.js';
import { extractGeneratedText } from './extractGeneratedText.js';
import { estimateCostUsd, readUsage, type TokenUsage } from './usage.js';
import {
  finishAiCall,
  formatCallLine,
  startAiCall,
  type AiCallRecord
} from '../reporting/aiCallReport.js';
import { translate } from '../translations/en.js';

type ParameterSchemas = Record<string, AIFunctionParameterSchema>;

interface CallTrace {
  attempts: number;
  cached: boolean;
  usage?: TokenUsage;
}

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

async function readCache(cacheFile: string): Promise<string | undefined> {
  try {
    return await readFile(cacheFile, 'utf8');
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

function getGeneratedFunction(
  parsed: unknown,
  spec: AIFunctionSpec
): string | undefined {
  const value = isRecord(parsed) ? parsed[spec.outputField] : undefined;
  return typeof value === 'string' ? value : undefined;
}

function parseCachedJson(
  cached: string,
  cacheFile: string,
  logger: Logger
): unknown {
  try {
    return JSON.parse(cached);
  } catch {
    logger.warn(`Ignoring unreadable cache file ${cacheFile}; regenerating.`);
    return undefined;
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryDelayMs(response: Response, attempt: number): number {
  const retryAfter = response.headers.get('retry-after');
  const seconds = retryAfter === null ? Number.NaN : Number(retryAfter);

  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, OPENAI_MAX_RETRY_AFTER_MS);
  }

  return OPENAI_RETRY_BASE_DELAY_MS * 2 ** attempt;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  logger: Logger
): Promise<{ response: Response; attempts: number }> {
  const maxAttempts = OPENAI_MAX_RETRIES + 1;

  for (let attempt = 0; ; attempt++) {
    const isLastAttempt = attempt + 1 >= maxAttempts;
    let response: Response;

    try {
      response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS)
      });
    } catch (error) {
      if (isLastAttempt) {
        throw new AIPluginError(
          translate('openAiNetworkError', {
            attempts: maxAttempts,
            cause: describeError(error)
          }),
          'openai_network',
          { cause: error }
        );
      }

      const delay = OPENAI_RETRY_BASE_DELAY_MS * 2 ** attempt;
      logger.warn(`OpenAI request failed: ${describeError(error)}. Retrying in ${delay}ms.`);
      await wait(delay);
      continue;
    }

    if (
      response.ok ||
      isLastAttempt ||
      !RETRYABLE_STATUSES.has(response.status)
    ) {
      return { response, attempts: attempt + 1 };
    }

    const delay = getRetryDelayMs(response, attempt);
    logger.warn(`OpenAI returned ${response.status}. Retrying in ${delay}ms.`);
    await response.body?.cancel().catch(() => undefined);
    await wait(delay);
  }
}

const inFlight = new Map<string, Promise<string>>();

export function generateAiFunction(
  config: AIConfig,
  root: string,
  spec: AIFunctionSpec,
  instruction: string,
  schema: Record<string, string>,
  api: API,
  parameterSchemas?: ParameterSchemas,
  resultShape?: ResultShape,
  logger: Logger = createLogger()
): Promise<string> {
  const cacheKey = hash(JSON.stringify({
    instruction,
    schema,
    model: config.model,
    compilerVersion: COMPILER_VERSION,
    ...(parameterSchemas ? { parameterSchemas } : {}),
    // Keyed only when present so cache files for scalar and array results stay valid.
    ...(resultShape ? { resultShape } : {}),
    // Sort keys stay unchanged so comparators cached before filterAi existed remain valid.
    ...(spec.kind === 'sort' ? {} : { kind: spec.kind })
  }));

  const cacheDir = path.resolve(root, config.generatedDir);
  const cacheFile = path.join(cacheDir, `${cacheKey}.json`);
  const pending = inFlight.get(cacheFile);

  if (pending) return pending;

  const trace: CallTrace = { attempts: 0, cached: false };
  const startedAt = performance.now();
  startAiCall();

  const generation = compileAiFunction(
    config,
    cacheDir,
    cacheFile,
    spec,
    instruction,
    schema,
    api,
    parameterSchemas,
    resultShape,
    trace,
    logger
  )
    .then(
      (generated) => {
        completeCall(logger, {
          spec,
          instruction,
          model: config.model,
          trace,
          startedAt,
          outcome: trace.cached ? 'cached' : 'generated'
        });
        return generated;
      },
      (error: unknown) => {
        completeCall(logger, {
          spec,
          instruction,
          model: config.model,
          trace,
          startedAt,
          outcome: 'failed',
          errorMessage: describeError(error)
        });
        throw error;
      }
    )
    .finally(() => {
      inFlight.delete(cacheFile);
    });

  inFlight.set(cacheFile, generation);
  return generation;
}

function completeCall(
  logger: Logger,
  call: {
    spec: AIFunctionSpec;
    instruction: string;
    model: string;
    trace: CallTrace;
    startedAt: number;
    outcome: AiCallRecord['outcome'];
    errorMessage?: string;
  }
): void {
  const { trace } = call;
  const record: AiCallRecord = {
    method: call.spec.method,
    instruction: call.instruction,
    model: call.model,
    outcome: call.outcome,
    durationMs: performance.now() - call.startedAt,
    attempts: trace.attempts,
    usage: trace.usage,
    costUsd: trace.usage ? estimateCostUsd(call.model, trace.usage) : 0,
    errorMessage: call.errorMessage
  };

  finishAiCall(record);
  logger.info(`   ${formatCallLine(record)}`);
}

async function compileAiFunction(
  config: AIConfig,
  cacheDir: string,
  cacheFile: string,
  spec: AIFunctionSpec,
  instruction: string,
  schema: Record<string, string>,
  api: API,
  parameterSchemas: ParameterSchemas | undefined,
  resultShape: ResultShape | undefined,
  trace: CallTrace,
  logger: Logger
): Promise<string> {
  if (config.cache) {
    const cached = await readCache(cacheFile);
    const cachedJson = cached === undefined
      ? undefined
      : parseCachedJson(cached, cacheFile, logger);

    if (cachedJson !== undefined) {
      const cachedFunction = getGeneratedFunction(cachedJson, spec);

      if (cachedFunction === undefined) {
        throw new AIPluginError(translate('invalidCachedFunction', {
          role: spec.role
        }), 'invalid_cache');
      }

      await validateAiFunction(
        cachedFunction,
        schema,
        spec,
        api,
        parameterSchemas,
        resultShape
      );
      trace.cached = true;
      return cachedFunction;
    }
  }

  logger.info(`\n🤖 AI compiling ${spec.method}(): "${instruction}"`);

  const { response, attempts } = await fetchWithRetry(
    OPENAI_RESPONSES_URL,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: config.model,
        instructions: `
You are a JavaScript ${spec.role} compiler.

Generate a single JavaScript arrow function:
${spec.signature}

Rules:
${spec.rules.map((rule) => `- ${rule}`).join('\n')}
- Output JavaScript code only inside the JSON field.
        `,
        input: JSON.stringify({
          instruction,
          schema,
          ...(parameterSchemas ? { parameterSchemas } : {}),
          availableVariables: spec.parameters
        }),
        text: {
          format: {
            type: 'json_schema',
            name: spec.schemaName,
            strict: true,
            schema: {
              type: 'object',
              properties: {
                [spec.outputField]: {
                  type: 'string'
                }
              },
              required: [spec.outputField],
              additionalProperties: false
            }
          }
        }
      })
    },
    logger
  );
  trace.attempts = attempts;

  if (!response.ok) {
    throw new AIPluginError(
      translate('openAiHttpError', {
        status: response.status,
        body: await response.text()
      }),
      'openai_http',
      { status: response.status }
    );
  }

  let body: unknown;

  try {
    body = await response.json();
  } catch (error) {
    throw new AIPluginError(
      translate('invalidOpenAiResponse'),
      'openai_response',
      { cause: error }
    );
  }

  trace.usage = readUsage(body);
  const output = extractGeneratedText(body);
  let parsed: unknown;

  try {
    parsed = JSON.parse(output);
  } catch (error) {
    throw new AIPluginError(
      translate('invalidGeneratedJson', {
        role: spec.role
      }),
      'openai_response',
      { cause: error }
    );
  }

  const generated = getGeneratedFunction(parsed, spec);

  if (generated === undefined) {
    throw new AIPluginError(
      translate('missingGeneratedFunction', { role: spec.role }),
      'openai_response'
    );
  }

  await validateAiFunction(
    generated,
    schema,
    spec,
    api,
    parameterSchemas,
    resultShape
  );

  if (config.cache) {
    await mkdir(cacheDir, { recursive: true });

    // Write to a unique temp file and rename so readers never see a partial cache file.
    const tempFile = `${cacheFile}.${randomUUID()}.tmp`;

    try {
      await writeFile(
        tempFile,
        JSON.stringify({ [spec.outputField]: generated }, null, 2)
      );
      await rename(tempFile, cacheFile);
    } catch (error) {
      await rm(tempFile, { force: true });
      throw error;
    }
  }

  logger.info(`✅ Generated: ${generated}`);

  return generated;
}

