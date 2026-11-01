import type { Logger } from 'vite';
import {
  PROVIDER_LABELS,
  PROVIDER_MAX_RETRIES,
  PROVIDER_MAX_RETRY_AFTER_MS,
  PROVIDER_RETRY_BASE_DELAY_MS,
  PROVIDER_TIMEOUT_MS
} from '../constants.js';
import { AIPluginError } from '../errors.js';
import { translate } from '../translations/en.js';
import type { ProviderId } from '../types.js';

/** HTTP status codes that trigger a retry. */
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

/**
 * Turns an unknown thrown value into a message string.
 *
 * @param error The thrown value.
 * @returns The error message, or `String(error)` for non-`Error` values.
 */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Resolves after the given delay.
 *
 * @param ms Delay in milliseconds.
 */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Computes how long to wait before retrying. Uses the `Retry-After` header when it is a
 * valid number of seconds, capped at {@link PROVIDER_MAX_RETRY_AFTER_MS}. Otherwise falls back
 * to exponential backoff.
 *
 * @param response The failed response.
 * @param attempt Zero-based index of the attempt that failed.
 * @returns The delay in milliseconds.
 */
function getRetryDelayMs(response: Response, attempt: number): number {
  const retryAfter = response.headers.get('retry-after');
  const seconds = retryAfter === null ? Number.NaN : Number(retryAfter);

  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, PROVIDER_MAX_RETRY_AFTER_MS);
  }

  return PROVIDER_RETRY_BASE_DELAY_MS * 2 ** attempt;
}

/**
 * POSTs to a provider endpoint with a per-request timeout. Retries network errors and
 * retryable HTTP statuses (see {@link RETRYABLE_STATUSES}) up to {@link PROVIDER_MAX_RETRIES} times.
 *
 * @param providerId Provider being called, used in log and error messages.
 * @param url The request URL.
 * @param init Fetch options, excluding the timeout signal.
 * @param logger Logger for retry warnings.
 * @returns The final response and the number of attempts made.
 * @throws {AIPluginError} With code `provider_network` when every attempt fails with a network error.
 */
export async function fetchWithRetry(
  providerId: ProviderId,
  url: string,
  init: RequestInit,
  logger: Logger
): Promise<{ response: Response; attempts: number }> {
  const provider = PROVIDER_LABELS[providerId];
  const maxAttempts = PROVIDER_MAX_RETRIES + 1;

  for (let attempt = 0; ; attempt++) {
    const isLastAttempt = attempt + 1 >= maxAttempts;
    let response: Response;

    try {
      response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS)
      });
    } catch (error) {
      if (isLastAttempt) {
        throw new AIPluginError(
          translate('providerNetworkError', {
            provider,
            attempts: maxAttempts,
            cause: describeError(error)
          }),
          'provider_network',
          { cause: error }
        );
      }

      const delay = PROVIDER_RETRY_BASE_DELAY_MS * 2 ** attempt;
      logger.warn(translate('providerRetryNetwork', {
        provider,
        message: describeError(error),
        delay
      }));
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
    logger.warn(translate('providerRetryStatus', {
      provider,
      status: response.status,
      delay
    }));
    await response.body?.cancel().catch(() => undefined);
    await wait(delay);
  }
}

/**
 * Builds the error for a non-2xx response.
 *
 * @param providerId Provider that returned the response.
 * @param response The failed response.
 * @returns The error to throw, including the response body.
 */
export async function createHttpError(
  providerId: ProviderId,
  response: Response
): Promise<AIPluginError> {
  return new AIPluginError(
    translate('providerHttpError', {
      provider: PROVIDER_LABELS[providerId],
      status: response.status,
      body: await response.text()
    }),
    'provider_http',
    { status: response.status }
  );
}

/**
 * Parses a response body as JSON.
 *
 * @param providerId Provider that returned the response.
 * @param response The successful response.
 * @returns The parsed body.
 * @throws {AIPluginError} With code `provider_response` when the body is not JSON.
 */
export async function readJsonBody(
  providerId: ProviderId,
  response: Response
): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    throw new AIPluginError(
      translate('invalidProviderResponse', { provider: PROVIDER_LABELS[providerId] }),
      'provider_response',
      { cause: error }
    );
  }
}

/**
 * Builds a JSON Schema for an object with one required string field.
 *
 * @param outputField Name of the string field.
 * @returns The schema object.
 */
export function outputJsonSchema(outputField: string): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      [outputField]: {
        type: 'string'
      }
    },
    required: [outputField],
    additionalProperties: false
  };
}
