import { describe, it } from 'vitest';
import { extractGeneratedText } from '../src/openai/extractGeneratedText.js';
import { measure } from './helpers.js';

const GENERATED = '{"predicate":"(item) => item.active"}';

const outputTextResponse = { id: 'resp_1', status: 'completed', output_text: GENERATED };

const outputArrayResponse = {
  id: 'resp_2',
  status: 'completed',
  output: [
    { type: 'reasoning', summary: [] },
    {
      type: 'message',
      content: [{ type: 'output_text', text: GENERATED, annotations: [] }]
    }
  ]
};

describe('extractGeneratedText', () => {
  it('reads the output_text shortcut', async () => {
    await measure('output_text shortcut', () => extractGeneratedText(outputTextResponse));
  });

  it('walks the Responses output array', async () => {
    await measure('Responses output array', () => extractGeneratedText(outputArrayResponse));
  });
});
