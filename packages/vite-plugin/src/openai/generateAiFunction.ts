import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { API } from 'typescript/unstable/sync';
import path from 'node:path';
import type { AIFunctionSpec } from '../aiFunctions.js';
import { validateAiFunction } from '../comparator/validateAiFunction.js';
import type { AIConfig } from '../types.js';
import { hash, isRecord } from '../utils.js';
import { extractGeneratedText } from './extractGeneratedText.js';

export async function generateAiFunction(
  config: AIConfig,
  root: string,
  spec: AIFunctionSpec,
  instruction: string,
  schema: Record<string, string>,
  api: API
): Promise<string> {
  const cacheKey = hash(JSON.stringify({
    instruction,
    schema,
    model: config.model,
    compilerVersion: 1,
    // Sort keys stay unchanged so comparators cached before filterAi existed remain valid.
    ...(spec.kind === 'sort' ? {} : { kind: spec.kind })
  }));

  const cacheDir = path.resolve(root, config.generatedDir);
  const cacheFile = path.join(cacheDir, `${cacheKey}.json`);

  if (config.cache) {
    let cached: string | undefined;

    try {
      cached = await readFile(cacheFile, 'utf8');
    } catch (error) {
      if (!isRecord(error) || error.code !== 'ENOENT') {
        throw error;
      }
    }

    if (cached !== undefined) {
      const parsed: unknown = JSON.parse(cached);

      const cachedFunction = isRecord(parsed)
        ? parsed[spec.outputField]
        : undefined;

      if (typeof cachedFunction !== 'string') {
        throw new Error(`Invalid cached ${spec.role}`);
      }

      await validateAiFunction(cachedFunction, schema, spec, api);
      return cachedFunction;
    }
  }

  console.log(`\n🤖 AI compiling ${spec.method}(): "${instruction}"`);

  const response = await fetch(
    'https://api.openai.com/v1/responses',
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
      `OpenAI error ${response.status}: ${await response.text()}`
    );
  }

  const result: unknown = await response.json();
  const output = extractGeneratedText(result);
  let parsed: unknown;

  try {
    parsed = JSON.parse(output);
  } catch (error) {
    throw new Error(`OpenAI returned invalid ${spec.role} JSON`, {
      cause: error
    });
  }

  const generated = isRecord(parsed)
    ? parsed[spec.outputField]
    : undefined;

  if (typeof generated !== 'string') {
    throw new Error(
      `OpenAI response is missing a ${spec.role} string`
    );
  }

  await validateAiFunction(generated, schema, spec, api);

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
