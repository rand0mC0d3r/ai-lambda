/**
 * Machine-readable categories for errors raised by the plugin.
 */
export type AIErrorCode =
  | 'invalid_config'
  | 'missing_api_key'
  | 'invalid_invocation'
  | 'unsupported_type'
  | 'type_check'
  | 'invalid_generated'
  | 'provider_http'
  | 'provider_network'
  | 'provider_response';

/**
 * Error thrown by the plugin, tagged with an {@link AIErrorCode} so callers can
 * choose a matching troubleshooting hint.
 */
export class AIPluginError extends Error {
  /** Category of the failure. */
  readonly code: AIErrorCode;
  /** HTTP status code for OpenAI HTTP failures. */
  readonly status?: number;

  /**
   * @param message Human-readable description of the failure.
   * @param code Category of the failure.
   * @param options Optional underlying `cause` and HTTP `status`.
   */
  constructor(
    message: string,
    code: AIErrorCode,
    options?: { cause?: unknown; status?: number }
  ) {
    super(message, { cause: options?.cause });
    this.name = 'AIPluginError';
    this.code = code;
    this.status = options?.status;
  }
}
