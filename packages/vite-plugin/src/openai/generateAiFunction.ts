import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { API } from 'typescript/unstable/sync';
import path from 'node:path';
import type { Logger } from 'vite';
import type {
  AIFunctionParameterSchema,
  AIFunctionSpec,
  ExpectedResult
} from '../aiFunctions.js';
import {
  COMPILER_VERSION,
  PROVIDER_LABELS
} from '../constants.js';
import { AIPluginError } from '../errors.js';
import { validateAiFunction } from '../functions/validateAiFunction.js';
import type { AIConfig } from '../types.js';
import { hash, isRecord } from '../utils.js';
import { describeError } from '../providers/common.js';
import { createProvider, type GenerationRequest } from '../providers/index.js';
import { estimateCostUsd, type TokenUsage } from './usage.js';
import {
  finishAiCall,
  formatCallLine,
  startAiCall,
  type AiCallRecord
} from '../reporting/aiCallReport.js';
import { translate } from '../translations/en.js';

/** Maps each generated-function parameter name to its schema. */
type ParameterSchemas = Record<string, AIFunctionParameterSchema>;

/**
 * Per-call bookkeeping collected while a request runs, reported in the build summary.
 */
interface CallTrace {
  /** Number of HTTP attempts made. Stays 0 when the result comes from cache. */
  attempts: number;
  /** Whether the result was read from the cache file. */
  cached: boolean;
  /** Token usage reported by OpenAI, when available. */
  usage?: TokenUsage;
}

/**
 * Reads a cache file as UTF-8 text.
 *
 * @param cacheFile Absolute path to the cache file.
 * @returns The file contents, or `undefined` if the file does not exist.
 * @throws Any read error other than a missing file.
 */
async function readCache(cacheFile: string): Promise<string | undefined> {
  try {
    return await readFile(cacheFile, 'utf8');
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

/**
 * Returns the generated code stored under the spec's output field.
 *
 * @param parsed The parsed cache or API payload.
 * @param spec The spec whose `outputField` names the code.
 * @returns The code string, or `undefined` if the field is missing or not a string.
 */
function getGeneratedFunction(
  parsed: unknown,
  spec: AIFunctionSpec
): string | undefined {
  const value = isRecord(parsed) ? parsed[spec.outputField] : undefined;
  return typeof value === 'string' ? value : undefined;
}

/**
 * Parses cached JSON. A corrupt file logs a warning and is treated as a cache miss.
 *
 * @param cached The raw file contents.
 * @param cacheFile The cache file path, used in the warning.
 * @param logger Logger for the warning.
 * @returns The parsed value, or `undefined` if parsing fails.
 */
function parseCachedJson(
  cached: string,
  cacheFile: string,
  logger: Logger
): unknown {
  try {
    return JSON.parse(cached);
  } catch {
    logger.warn(translate('unreadableCacheFile', { cacheFile }));
    return undefined;
  }
}

/** Requests that are in progress, keyed by cache file, so identical calls share one request. */
const inFlight = new Map<string, Promise<string>>();

/**
 * Returns generated code for one AI call. Reads the cache first when enabled, otherwise
 * asks OpenAI. Concurrent calls for the same cache file share one promise.
 *
 * @param config Resolved plugin configuration.
 * @param root Vite root, used to resolve `generatedDir`.
 * @param spec Spec for the AI method being generated.
 * @param instruction The natural-language instruction from the source.
 * @param schema Field names and types of the array element or argument.
 * @param api TypeScript API used to validate the result.
 * @param parameterSchemas Schemas for extra parameters, when present.
 * @param expectedResult Declared types and result key shape, when known.
 * @param logger Logger for progress and summary output.
 * @returns The generated JavaScript arrow function as source text.
 */
export function generateAiFunction(
  config: AIConfig,
  root: string,
  spec: AIFunctionSpec,
  instruction: string,
  schema: Record<string, string>,
  api: API,
  parameterSchemas: ParameterSchemas | undefined,
  expectedResult: ExpectedResult | undefined,
  logger: Logger
): Promise<string> {
  const cacheKey = hash(JSON.stringify({
    instruction,
    schema,
    model: config.model,
    // Non-OpenAI keys add the provider so cache files for OpenAI stay valid.
    ...(config.provider === 'openai'
      ? {}
      : { provider: config.provider, baseUrl: config.baseUrl }),
    compilerVersion: COMPILER_VERSION,
    ...(parameterSchemas ? { parameterSchemas } : {}),
    // Keyed only when present so cache files for scalar and array results stay valid.
    // Type text is not keyed: cached code is re-validated against it on every read.
    ...(expectedResult?.shape ? { resultShape: expectedResult.shape } : {}),
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
    expectedResult,
    trace,
    logger
  )
    .then(
      (generated) => {
        completeCall(logger, {
          spec,
          instruction,
          provider: config.provider,
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
          provider: config.provider,
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

/**
 * Records a finished call in the build report and logs its summary line.
 *
 * @param logger Logger for the summary line.
 * @param call Details of the finished call.
 */
function completeCall(
  logger: Logger,
  call: {
    spec: AIFunctionSpec;
    instruction: string;
    provider: AIConfig['provider'];
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
    // Pricing is only known for OpenAI models.
    costUsd: trace.usage && call.provider === 'openai'
      ? estimateCostUsd(call.model, trace.usage)
      : undefined,
    errorMessage: call.errorMessage
  };

  finishAiCall(record);
  logger.info(`   ${formatCallLine(record)}`);
}

/**
 * Reads and validates a cached function. A corrupt, incomplete, or stale entry returns
 * `undefined` so the caller regenerates it.
 *
 * @param cacheFile Path to the cache file.
 * @param spec Spec for the AI method.
 * @param schema Field names and types of the array element or argument.
 * @param api TypeScript API used to validate the cached code.
 * @param parameterSchemas Schemas for extra parameters, when present.
 * @param expectedResult Declared types and result key shape, when known.
 * @param logger Logger for warnings.
 * @returns The cached code, or `undefined` if there is no usable entry.
 */
async function readCachedFunction(
  cacheFile: string,
  spec: AIFunctionSpec,
  schema: Record<string, string>,
  api: API,
  parameterSchemas: ParameterSchemas | undefined,
  expectedResult: ExpectedResult | undefined,
  logger: Logger
): Promise<string | undefined> {
  const cached = await readCache(cacheFile);
  if (cached === undefined) return undefined;

  const cachedJson = parseCachedJson(cached, cacheFile, logger);
  if (cachedJson === undefined) return undefined;

  const cachedFunction = getGeneratedFunction(cachedJson, spec);

  if (cachedFunction === undefined) {
    logger.warn(translate('invalidCacheRegenerating', {
      cacheFile,
      reason: translate('invalidCachedFunction', { role: spec.role })
    }));
    return undefined;
  }

  try {
    await validateAiFunction(
      cachedFunction,
      schema,
      spec,
      api,
      parameterSchemas,
      expectedResult
    );
  } catch (error) {
    // A stale cache entry (e.g. produced before a validator change) should be replaced, not fail the build.
    logger.warn(translate('invalidCacheRegenerating', {
      cacheFile,
      reason: describeError(error)
    }));
    return undefined;
  }

  return cachedFunction;
}

/**
 * Produces generated code by reading the cache or calling OpenAI, then writes the result
 * to the cache. The caller is responsible for validation of new results.
 *
 * @param config Resolved plugin configuration.
 * @param cacheDir Directory that holds cache files.
 * @param cacheFile Path to this call's cache file.
 * @param spec Spec for the AI method.
 * @param instruction The natural-language instruction from the source.
 * @param schema Field names and types of the array element or argument.
 * @param api TypeScript API used to validate the result.
 * @param parameterSchemas Schemas for extra parameters, when present.
 * @param expectedResult Declared types and result key shape, when known.
 * @param trace Mutable record updated with attempts, cache status, and usage.
 * @param logger Logger for progress output.
 * @returns The generated JavaScript arrow function as source text.
 */
async function compileAiFunction(
  config: AIConfig,
  cacheDir: string,
  cacheFile: string,
  spec: AIFunctionSpec,
  instruction: string,
  schema: Record<string, string>,
  api: API,
  parameterSchemas: ParameterSchemas | undefined,
  expectedResult: ExpectedResult | undefined,
  trace: CallTrace,
  logger: Logger
): Promise<string> {
  if (config.cache) {
    const cachedFunction = await readCachedFunction(
      cacheFile,
      spec,
      schema,
      api,
      parameterSchemas,
      expectedResult,
      logger
    );

    if (cachedFunction !== undefined) {
      trace.cached = true;
      return cachedFunction;
    }
  }

  logger.info(translate('aiCompiling', { method: spec.method, instruction }));

  const providerLabel = PROVIDER_LABELS[config.provider];
  const request: GenerationRequest = {
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
    schemaName: spec.schemaName,
    outputField: spec.outputField
  };

  const output = await createProvider(config).generate(request, trace, logger);
  let parsed: unknown;

  try {
    parsed = JSON.parse(output);
  } catch (error) {
    throw new AIPluginError(
      translate('invalidGeneratedJson', {
        provider: providerLabel,
        role: spec.role
      }),
      'provider_response',
      { cause: error }
    );
  }

  const generated = getGeneratedFunction(parsed, spec);

  if (generated === undefined) {
    throw new AIPluginError(
      translate('missingGeneratedFunction', {
        provider: providerLabel,
        role: spec.role
      }),
      'provider_response'
    );
  }

  await validateAiFunction(
    generated,
    schema,
    spec,
    api,
    parameterSchemas,
    expectedResult
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

  logger.info(translate('generatedFunction', { generated }));

  return generated;
}

