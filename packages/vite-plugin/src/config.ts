import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  AI_CONFIG_FILE,
  DEFAULT_GENERATED_DIR,
  DEFAULT_MODEL,
  DEFAULT_PROVIDER,
  PROVIDER_IDS,
  PROVIDER_LABELS
} from './constants.js';
import { AIPluginError } from './errors.js';
import { translate } from './translations/en.js';
import type { AIConfig, ProviderId } from './types.js';
import { isRecord } from './utils.js';

/**
 * Top-level keys allowed in `.ai-rc.json`.
 */
const SUPPORTED_KEYS = ['apiKey', 'provider', 'model', 'baseUrl', 'cache', 'generatedDir'];

/**
 * Reads and validates `.ai-rc.json`.
 *
 * @param configPath Absolute path to the config file.
 * @param root The resolved Vite root, used to validate `generatedDir`.
 * @returns The validated config with defaults applied.
 * @throws {AIPluginError} With code `invalid_config` or `missing_api_key` when the file is invalid.
 */
export async function readAiConfig(
  configPath: string,
  root: string
): Promise<AIConfig> {
  const source = await readFile(configPath, 'utf8');
  let raw: unknown;

  try {
    raw = JSON.parse(source);
  } catch (error) {
    throw new AIPluginError(
      translate('invalidAiConfigJson', {
        configFile: AI_CONFIG_FILE,
        cause: error instanceof Error ? error.message : String(error)
      }),
      'invalid_config',
      { cause: error }
    );
  }

  return validateAiConfig(raw, root);
}

/**
 * Validates parsed `.ai-rc.json` contents and applies defaults.
 *
 * @param raw The parsed JSON value.
 * @param root The resolved Vite root, used to validate `generatedDir`.
 * @returns The validated config.
 * @throws {AIPluginError} When the value is not an object, contains unknown keys,
 * or has an invalid or missing `provider`, `apiKey`, `model`, `baseUrl`, `cache`, or `generatedDir`.
 */
export function validateAiConfig(raw: unknown, root: string): AIConfig {
  if (!isRecord(raw)) {
    throw new AIPluginError(translate('aiConfigNotObject', { configFile: AI_CONFIG_FILE }), 'invalid_config');
  }

  const unknownKeys = Object.keys(raw).filter(
    (key) => !SUPPORTED_KEYS.includes(key)
  );

  if (unknownKeys.length) {
    throw new AIPluginError(
      translate('unknownAiConfigKeys', {
        configFile: AI_CONFIG_FILE,
        keys: unknownKeys.join(', ')
      }),
      'invalid_config'
    );
  }

  const provider = raw.provider ?? DEFAULT_PROVIDER;

  if (!isProviderId(provider)) {
    throw new AIPluginError(
      translate('invalidProvider', {
        configFile: AI_CONFIG_FILE,
        providers: PROVIDER_IDS.join(', ')
      }),
      'invalid_config'
    );
  }

  const allowsMissingApiKey = provider === 'openai-compatible';

  if (raw.apiKey === undefined && !allowsMissingApiKey) {
    throw new AIPluginError(
      translate('missingApiKey', { provider: PROVIDER_LABELS[provider] }),
      'missing_api_key'
    );
  }

  if (raw.apiKey !== undefined && !isNonEmptyString(raw.apiKey)) {
    throw new AIPluginError(translate('invalidApiKey', { configFile: AI_CONFIG_FILE }), 'invalid_config');
  }

  if (raw.model === undefined && provider !== DEFAULT_PROVIDER) {
    throw new AIPluginError(
      translate('missingModel', { configFile: AI_CONFIG_FILE, provider }),
      'invalid_config'
    );
  }

  if (raw.model !== undefined && !isNonEmptyString(raw.model)) {
    throw new AIPluginError(translate('invalidModel', { configFile: AI_CONFIG_FILE }), 'invalid_config');
  }

  if (provider === 'openai-compatible' && raw.baseUrl === undefined) {
    throw new AIPluginError(translate('missingBaseUrl', { configFile: AI_CONFIG_FILE }), 'invalid_config');
  }

  if (raw.baseUrl !== undefined && provider !== 'openai-compatible') {
    throw new AIPluginError(translate('baseUrlNotSupported', { configFile: AI_CONFIG_FILE }), 'invalid_config');
  }

  if (raw.baseUrl !== undefined && !isHttpUrl(raw.baseUrl)) {
    throw new AIPluginError(translate('invalidBaseUrl', { configFile: AI_CONFIG_FILE }), 'invalid_config');
  }

  if (raw.cache !== undefined && typeof raw.cache !== 'boolean') {
    throw new AIPluginError(translate('invalidCache', { configFile: AI_CONFIG_FILE }), 'invalid_config');
  }

  if (raw.generatedDir !== undefined && !isCacheDirInsideRoot(raw.generatedDir, root)) {
    throw new AIPluginError(
      translate('invalidGeneratedDir', { configFile: AI_CONFIG_FILE }),
      'invalid_config'
    );
  }

  return {
    apiKey: raw.apiKey ?? '',
    provider,
    model: raw.model ?? DEFAULT_MODEL,
    ...(raw.baseUrl !== undefined ? { baseUrl: raw.baseUrl.replace(/\/+$/, '') } : {}),
    cache: raw.cache ?? true,
    generatedDir: raw.generatedDir ?? DEFAULT_GENERATED_DIR
  };
}

/**
 * Checks whether a value is one of the supported provider identifiers.
 *
 * @param value The value to check.
 * @returns `true` when the value is a known provider.
 */
function isProviderId(value: unknown): value is ProviderId {
  return (PROVIDER_IDS as readonly unknown[]).includes(value);
}

/**
 * Checks whether a value is an absolute `http:` or `https:` URL.
 *
 * @param value The value to check.
 * @returns `true` for a valid HTTP(S) URL.
 */
function isHttpUrl(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;

  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Checks whether a value is a string with non-whitespace content.
 *
 * @param value The value to check.
 * @returns `true` for a non-blank string.
 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Checks that `generatedDir` is a relative path that stays inside the Vite root.
 *
 * @param value The configured directory.
 * @param root The resolved Vite root.
 * @returns `true` when the path is valid.
 */
function isCacheDirInsideRoot(value: unknown, root: string): value is string {
  if (!isNonEmptyString(value) || path.isAbsolute(value)) {
    return false;
  }

  const relative = path.relative(root, path.resolve(root, value));

  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}
