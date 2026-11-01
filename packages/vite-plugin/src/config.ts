import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  AI_CONFIG_FILE,
  DEFAULT_GENERATED_DIR,
  DEFAULT_MODEL
} from './constants.js';
import { AIPluginError } from './errors.js';
import { translate } from './translations/en.js';
import type { AIConfig } from './types.js';
import { isRecord } from './utils.js';

const SUPPORTED_KEYS = ['apiKey', 'model', 'cache', 'generatedDir'];

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

  if (raw.apiKey === undefined) {
    throw new AIPluginError(translate('missingApiKey'), 'missing_api_key');
  }

  if (!isNonEmptyString(raw.apiKey)) {
    throw new AIPluginError(translate('invalidApiKey', { configFile: AI_CONFIG_FILE }), 'invalid_config');
  }

  if (raw.model !== undefined && !isNonEmptyString(raw.model)) {
    throw new AIPluginError(translate('invalidModel', { configFile: AI_CONFIG_FILE }), 'invalid_config');
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
    apiKey: raw.apiKey,
    model: raw.model ?? DEFAULT_MODEL,
    cache: raw.cache ?? true,
    generatedDir: raw.generatedDir ?? DEFAULT_GENERATED_DIR
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

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
