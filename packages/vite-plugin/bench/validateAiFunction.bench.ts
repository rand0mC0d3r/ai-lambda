import { API } from 'typescript/unstable/sync';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { aiFunctionSpecs } from '../src/constants.js';
import { validateAiFunction } from '../src/functions/validateAiFunction.js';
import { measure } from './helpers.js';

const schema = { name: 'string', price: 'number', active: 'boolean' };

describe('validateAiFunction', () => {
  let api: API;

  beforeAll(async () => {
    api = new API();
    await validateAiFunction('(a, b) => a.price - b.price', schema, aiFunctionSpecs.sortAi, api);
  });

  afterAll(() => {
    api.close();
  });

  it('validates a sortAi comparator', async () => {
    await measure('validate sortAi comparator', () =>
      validateAiFunction('(a, b) => a.price - b.price', schema, aiFunctionSpecs.sortAi, api), { time: 2000 });
  });

  it('validates a filterAi predicate', async () => {
    await measure('validate filterAi predicate', () =>
      validateAiFunction('(item) => item.active', schema, aiFunctionSpecs.filterAi, api), { time: 2000 });
  });
});
