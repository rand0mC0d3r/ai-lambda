import { isRecord } from '../utils.ts';

export function extractGeneratedText(result: unknown): string {
  if (!isRecord(result)) {
    throw new Error('OpenAI returned an invalid response');
  }

  if (
    typeof result.output_text === 'string' &&
    result.output_text.trim()
  ) {
    return result.output_text;
  }

  const text: string[] = [];
  const refusals: string[] = [];

  if (Array.isArray(result.output)) {
    for (const item of result.output) {
      if (
        !isRecord(item) ||
        item.type !== 'message' ||
        !Array.isArray(item.content)
      ) {
        continue;
      }

      for (const part of item.content) {
        if (!isRecord(part)) continue;

        if (
          part.type === 'output_text' &&
          typeof part.text === 'string'
        ) {
          text.push(part.text);
        } else if (
          part.type === 'refusal' &&
          typeof part.refusal === 'string'
        ) {
          refusals.push(part.refusal);
        }
      }
    }
  }

  const output = text.join('');

  if (output.trim()) return output;
  if (refusals.length) {
    throw new Error(
      `OpenAI refused AI function generation: ${refusals.join(' ')}`
    );
  }

  const details = [
    typeof result.status === 'string' && `status=${result.status}`,
    isRecord(result.incomplete_details) &&
      typeof result.incomplete_details.reason === 'string' &&
      `reason=${result.incomplete_details.reason}`,
    typeof result.id === 'string' && `response=${result.id}`
  ].filter(Boolean);

  throw new Error(
    `OpenAI returned no generated text${details.length ? ` (${details.join(', ')})` : ''}`
  );
}
