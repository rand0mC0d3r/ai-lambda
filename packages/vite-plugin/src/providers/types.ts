import type { Logger } from 'vite';
import type { TokenUsage } from '../openai/usage.js';

/**
 * Inputs for one generation request, shared by every provider.
 */
export interface GenerationRequest {
  /** System-level instructions describing the function to generate. */
  instructions: string;
  /** JSON payload with the instruction, schema, and available variables. */
  input: string;
  /** Name for the structured-output schema. */
  schemaName: string;
  /** Name of the string field that holds the generated function. */
  outputField: string;
}

/**
 * Bookkeeping a provider fills in while a request runs.
 */
export interface GenerationTrace {
  /** Number of HTTP attempts made. */
  attempts: number;
  /** Token usage reported by the provider, when available. */
  usage?: TokenUsage;
}

/**
 * Calls a language model API and returns the structured output.
 */
export interface LlmProvider {
  /**
   * Sends a generation request.
   *
   * @param request The prompt, payload, and output schema.
   * @param trace Updated with attempts and usage as the request runs.
   * @param logger Logger for retry warnings.
   * @returns JSON text containing the output field.
   * @throws {AIPluginError} When the request fails or the response has no usable output.
   */
  generate(
    request: GenerationRequest,
    trace: GenerationTrace,
    logger: Logger
  ): Promise<string>;
}

