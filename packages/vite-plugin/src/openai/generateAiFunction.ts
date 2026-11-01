import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { API } from 'typescript/unstable/sync';
import path from 'node:path';
import type {
  AIFunctionParameterSchema,
  AIFunctionSpec
} from '../aiFunctions.js';
import {
  COMPILER_VERSION,
  OPENAI_RESPONSES_URL
} from '../constants.js';
import { validateAiFunction } from '../functions/validateAiFunction.js';
import type { AIConfig } from '../types.js';
import { hash, isRecord } from '../utils.js';
import { extractGeneratedText } from './extractGeneratedText.js';
import { translate } from '../translations/en.js';

type ParameterSchemas = Record<string, AIFunctionParameterSchema>;

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

export async function generateAiFunction(
  config: AIConfig,
  root: string,
  spec: AIFunctionSpec,
  instruction: string,
  schema: Record<string, string>,
  api: API,
  parameterSchemas?: ParameterSchemas
): Promise<string> {
  const cacheKey = hash(JSON.stringify({
    instruction,
    schema,
    model: config.model,
    compilerVersion: COMPILER_VERSION,
    ...(parameterSchemas ? { parameterSchemas } : {}),
    // Sort keys stay unchanged so comparators cached before filterAi existed remain valid.
    ...(spec.kind === 'sort' ? {} : { kind: spec.kind })
  }));

  const cacheDir = path.resolve(root, config.generatedDir);
  const cacheFile = path.join(cacheDir, `${cacheKey}.json`);

  if (config.cache) {
    const cached = await readCache(cacheFile);

    if (cached !== undefined) {
      const cachedFunction = getGeneratedFunction(JSON.parse(cached), spec);

      if (cachedFunction === undefined) {
        throw new Error(translate('invalidCachedFunction', {
          role: spec.role
        }));
      }

      await validateAiFunction(
        cachedFunction,
        schema,
        spec,
        api,
        parameterSchemas
      );
      return cachedFunction;
    }
  }

  console.log(`\n🤖 AI compiling ${spec.method}(): "${instruction}"`);

  const response = await fetch(
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
    }
  );

  if (!response.ok) {
    throw new Error(
      translate('openAiHttpError', {
        status: response.status,
        body: await response.text()
      })
    );
  }

  const output = extractGeneratedText(await response.json());
  let parsed: unknown;

  try {
    parsed = JSON.parse(output);
  } catch (error) {
    throw new Error(translate('invalidGeneratedJson', {
      role: spec.role
    }), {
      cause: error
    });
  }

  const generated = getGeneratedFunction(parsed, spec);

  if (generated === undefined) {
    throw new Error(
      translate('missingGeneratedFunction', { role: spec.role })
    );
  }

  await validateAiFunction(
    generated,
    schema,
    spec,
    api,
    parameterSchemas
  );

  if (config.cache) {
    await mkdir(cacheDir, { recursive: true });

    await writeFile(
      cacheFile,
      JSON.stringify({ [spec.outputField]: generated }, null, 2)
    );
  }

  console.log(`✅ Generated: ${generated}`);

  return generated;
}
