import { describe, expect, it } from 'vitest';
import { extractGeneratedText } from '../src/openai/extractGeneratedText.js';

describe('extractGeneratedText', () => {
  it('prefers a non-empty output_text field', () => {
    expect(extractGeneratedText({ output_text: '  {"result":1}  ' })).toBe(
      '  {"result":1}  '
    );
  });

  it('joins text parts from message output items', () => {
    expect(
      extractGeneratedText({
        output: [
          { type: 'reasoning', content: [{ type: 'output_text', text: 'skip' }] },
          {
            type: 'message',
            content: [
              { type: 'output_text', text: '{"result":' },
              { type: 'refusal', refusal: 'ignored beside text' },
              { type: 'output_text', text: '1}' }
            ]
          }
        ]
      })
    ).toBe('{"result":1}');
  });

  it('reports refusals when no text was generated', () => {
    expect(() =>
      extractGeneratedText({
        output: [{
          type: 'message',
          content: [{ type: 'refusal', refusal: 'Not allowed.' }]
        }]
      })
    ).toThrow('OpenAI refused AI function generation: Not allowed.');
  });

  it('includes response status details when output is empty', () => {
    expect(() =>
      extractGeneratedText({
        output: [],
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
        id: 'response-id'
      })
    ).toThrow(
      'OpenAI returned no generated text (status=incomplete, reason=max_output_tokens, response=response-id)'
    );
  });

  it('rejects malformed or empty responses', () => {
    expect(() => extractGeneratedText(null)).toThrow(
      'OpenAI returned an invalid response'
    );
    expect(() => extractGeneratedText({ output_text: '  ', output: [] })).toThrow(
      'OpenAI returned no generated text'
    );
  });
});
