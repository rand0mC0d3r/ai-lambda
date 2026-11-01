export type AIErrorCode =
  | 'invalid_config'
  | 'missing_api_key'
  | 'invalid_invocation'
  | 'unsupported_type'
  | 'type_check'
  | 'invalid_generated'
  | 'openai_http'
  | 'openai_network'
  | 'openai_response';

export class AIPluginError extends Error {
  readonly code: AIErrorCode;
  readonly status?: number;

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
