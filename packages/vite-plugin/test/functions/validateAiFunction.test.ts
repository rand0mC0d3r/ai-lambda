import { afterEach, describe, expect, it } from 'vitest';
import { aiFunctionSpecs } from '../../src/constants.js';
import { validateAiFunction } from '../../src/functions/validateAiFunction.js';
import { API } from 'typescript/unstable/sync';

describe('validateAiFunction', () => {
  let api: API | undefined;

  afterEach(() => {
    api?.close();
    api = undefined;
  });

  function validator() {
    api = new API();
    return (code: string, kind: keyof typeof aiFunctionSpecs = 'sortAi') =>
      validateAiFunction(
        code,
        { price: 'number', name: 'string' },
        aiFunctionSpecs[kind],
        api!
      );
  }

  it('accepts a schema-aware expression-bodied comparator', async () => {
    await validator()('(a, b) => a.price - b.price');
  });

  it('accepts allowed helpers and mapped object results', async () => {
    await validator()(
      '(item) => ({...item, price: Math.round(item.price)})',
      'mapAi'
    );
    await validator()(
      '(item) => item.name.includes("pro")',
      'filterAi'
    );
    await validator()(
      '(item) => item.name.includes("pro")',
      'findAi'
    );
    await validator()(
      '(item) => item.price > 100',
      'someAi'
    );
  });

  it('accepts reduce array expressions and accumulator schemas', async () => {
    api = new API();
    await validateAiFunction(
      '(acc, item) => [...acc, item]',
      { price: 'number' },
      aiFunctionSpecs.reduceAi,
      api,
      {
        acc: {
          kind: 'array',
          elementType: 'object',
          elementFields: { price: 'number' }
        },
        item: { kind: 'object', fields: { price: 'number' } }
      }
    );
  });

  it('accepts only parameter-based spreads and declared helper receivers', async () => {
    await validator()(
      '(item) => ({...item, price: Math.round(item.price)})',
      'mapAi'
    );
    api = new API();
    await validateAiFunction(
      '(acc, item) => [...acc, item]',
      { price: 'number' },
      aiFunctionSpecs.reduceAi,
      api,
      {
        acc: {
          kind: 'array',
          elementType: 'object',
          elementFields: { price: 'number' }
        },
        item: { kind: 'object', fields: { price: 'number' } }
      }
    );

    await expect(
      validator()('(item) => ({...item.price})', 'mapAi')
    ).rejects.toThrow('Object spread is only permitted on object parameters');
    await expect(
      validator()('(item) => item.round(item.price)', 'mapAi')
    ).rejects.toThrow();
  });

  it.each([
    ['computed property access', '(item) => item["price"]'],
    ['optional property access', '(item) => item?.price'],
    ['optional calls', '(item) => item.name?.includes("pro")'],
    ['prototype access', '(item) => item.__proto__'],
    ['constructor access', '(item) => item.constructor'],
    ['prototype object keys', '(item) => ({__proto__: item})'],
    ['computed object keys', '(item) => ({[item.name]: item.price})'],
    ['shorthand object keys', '(item) => ({price})'],
    ['loose equality', '(item) => item.price == "10"'],
    ['string coercion through addition', '(item) => item.name + item.price'],
    ['assignment', '(item) => item.price = 1'],
    ['indirect global access', '(item) => ({}).constructor.constructor("return 1")()'],
    ['bare schema field', '(item) => price'],
    ['bare global', '(item) => Math'],
    ['lexical this', '(item) => this']
  ])('rejects %s', async (_label, code) => {
    await expect(validator()(code, 'mapAi')).rejects.toThrow();
  });

  it('rejects accessor and setter definitions', async () => {
    await expect(
      validator()(
        '(item) => ({ get price() { return item.price; } })',
        'mapAi'
      )
    ).rejects.toThrow();
    await expect(
      validator()(
        '(item) => ({ set price(value) { item.price = value; } })',
        'mapAi'
      )
    ).rejects.toThrow();
  });

  it.each([
    ['wrong parameter names', '(left, right) => left.price - right.price'],
    ['wrong parameter count', '(item) => item.price'],
    ['block bodies', '(a, b) => { return a.price - b.price; }'],
    ['unknown identifiers', '(a, b) => a.price - b.cost'],
    ['forbidden calls', '(item) => fetch(item.name)'],
    ['unsupported syntax', '(item) => item.price++'],
    ['invalid syntax', '(item) => item.']
  ])('rejects %s', async (_label, code) => {
    await expect(validator()(code)).rejects.toThrow();
  });

  it('rejects array literals outside reducers and bad reducers', async () => {
    await expect(validator()('(item) => [item]', 'mapAi')).rejects.toThrow(
      'Array literals are only permitted in reduceAi reducers'
    );
    api = new API();
    await expect(
      validateAiFunction(
        '(acc, item) => acc + item.price',
        { price: 'number' },
        aiFunctionSpecs.reduceAi,
        api,
        {
          acc: { kind: 'scalar', type: 'number' },
          item: { kind: 'object', fields: { price: 'number' } }
        }
      )
    ).resolves.toBeUndefined();
  });

  describe('declared result shape', () => {
    const shape = {
      fields: { price: 'number', name: 'string' },
      optionalFields: ['name']
    } as const;

    async function checkResult(code: string, resultShape = shape) {
      api?.close();
      api = new API();
      await validateAiFunction(
        code,
        { price: 'number', name: 'string' },
        aiFunctionSpecs.mapAi,
        api,
        undefined,
        resultShape
      );
    }

    it('accepts results that provide every required field', async () => {
      await checkResult('(item) => ({price: item.price})');
      await checkResult('(item) => ({...item})');
      await checkResult('(item) => ({...item, price: item.price * 2})');
      await checkResult('(item) => item');
    });

    it('rejects results that omit a required field', async () => {
      await expect(
        checkResult('(item) => ({name: item.name})')
      ).rejects.toThrow('Generated result is missing declared field: price');
    });

    it('rejects object literal keys the result type does not declare', async () => {
      await expect(
        checkResult('(item) => ({price: item.price, cost: item.price})')
      ).rejects.toThrow('Generated result has undeclared field: cost');
    });

    it('treats optional fields as not required', async () => {
      await checkResult('(item) => ({price: item.price})');
    });

    it('rejects non-object results when the result type is an object', async () => {
      await expect(checkResult('(item) => item.price')).rejects.toThrow(
        'Generated result must be an object literal or an object parameter'
      );
    });

    it('skips the check when no result shape is supplied', async () => {
      api?.close();
      api = new API();
      await validateAiFunction(
        '(item) => item.price',
        { price: 'number', name: 'string' },
        aiFunctionSpecs.mapAi,
        api
      );
    });
  });
});
