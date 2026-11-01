import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  AI_CONFIG_FILE,
  DEFAULT_GENERATED_DIR,
  DEFAULT_MODEL
} from './constants.js';
import { translate } from './translations/en.js';
import type { AIConfig } from './types.js';

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
    throw new Error(
      translate('invalidAiConfigJson', {
        configFile: AI_CONFIG_FILE,
        cause: error instanceof Error ? error.message : String(error)
      }),
      { cause: error }
    );
  }

  return validateAiConfig(raw, root);
}

export function validateAiConfig(raw: unknown, root: string): AIConfig {
  if (!isRecord(raw)) {
    throw new Error(translate('aiConfigNotObject', { configFile: AI_CONFIG_FILE }));
  }

  const unknownKeys = Object.keys(raw).filter(
    (key) => !SUPPORTED_KEYS.includes(key)
  );

  if (unknownKeys.length) {
    throw new Error(
      translate('unknownAiConfigKeys', {
        configFile: AI_CONFIG_FILE,
        keys: unknownKeys.join(', ')
      })
    );
  }

  if (raw.apiKey === undefined) {
    throw new Error(translate('missingApiKey'));
  }

  if (!isNonEmptyString(raw.apiKey)) {
    throw new Error(translate('invalidApiKey', { configFile: AI_CONFIG_FILE }));
  }

  if (raw.model !== undefined && !isNonEmptyString(raw.model)) {
    throw new Error(translate('invalidModel', { configFile: AI_CONFIG_FILE }));
  }

  if (raw.cache !== undefined && typeof raw.cache !== 'boolean') {
    throw new Error(translate('invalidCache', { configFile: AI_CONFIG_FILE }));
  }

  if (raw.generatedDir !== undefined && !isCacheDirInsideRoot(raw.generatedDir, root)) {
    throw new Error(
      translate('invalidGeneratedDir', { configFile: AI_CONFIG_FILE })
    );
  }

  return {
    apiKey: raw.apiKey,
    model: raw.model ?? DEFAULT_MODEL,
    cache: raw.cache ?? true,
    generatedDir: raw.generatedDir ?? DEFAULT_GENERATED_DIR
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
