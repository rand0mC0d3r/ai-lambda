import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { validateComparator } from '../comparator/validateComparator.ts';
import type { AIConfig } from '../types.ts';
import { hash, isRecord } from '../utils.ts';
import { extractGeneratedText } from './extractGeneratedText.ts';

export async function generateComparator(
  config: AIConfig,
  root: string,
  instruction: string,
  schema: Record<string, string>
): Promise<string> {
  const cacheKey = hash(JSON.stringify({
    instruction,
    schema,
    model: config.model,
    compilerVersion: 1
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

      if (!isRecord(parsed) || typeof parsed.comparator !== 'string') {
        throw new Error('Invalid cached comparator');
      }

      validateComparator(parsed.comparator, schema);
      return parsed.comparator;
    }
  }

  console.log(`\n🤖 AI compiling: "${instruction}"`);

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
You are a JavaScript comparator compiler.

Generate a single JavaScript arrow function:
(a, b) => ...

Rules:
- Return a negative number when a comes first.
- Return zero when equivalent.
- Return a positive number when b comes first.
- Only access fields defined in the supplied schema.
- Use arithmetic for numeric comparisons.
- Use localeCompare with numeric:true and sensitivity:"base"
  for natural string sorting.
- No external dependencies.
- No mutations.
- No additional variables or statements.
- Output JavaScript code only inside the JSON field.
        `,
        input: JSON.stringify({
          instruction,
          schema,
          availableVariables: ['a', 'b']
        }),
        text: {
          format: {
            type: 'json_schema',
            name: 'sort_comparator',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                comparator: {
                  type: 'string'
                }
              },
              required: ['comparator'],
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
    throw new Error('OpenAI returned invalid comparator JSON', {
      cause: error
    });
  }

  if (!isRecord(parsed) || typeof parsed.comparator !== 'string') {
    throw new Error('OpenAI response is missing a comparator string');
  }

  const comparator = parsed.comparator;

  validateComparator(comparator, schema);

  if (config.cache) {
    await mkdir(cacheDir, { recursive: true });

    await writeFile(
      cacheFile,
      JSON.stringify({ comparator }, null, 2)
    );
  }

  console.log(`✅ Generated: ${comparator}`);

  return comparator;
}
