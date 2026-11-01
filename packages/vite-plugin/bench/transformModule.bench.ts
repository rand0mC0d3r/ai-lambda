import { afterAll, beforeAll, describe, it, vi } from 'vitest';
import { resetAiCallReport } from '../src/reporting/aiCallReport.js';
import { callCloseBundle, callTransform } from '../test/helpers.js';
import {
  createProject,
  generatedCodeFetch,
  measure,
  moduleWithAiCalls,
  offlineFetch,
  startPlugin
} from './helpers.js';

const PLAIN_MODULE = `
const numbers = [3, 1, 2];
const doubled = numbers.map((value) => value * 2);
`;

describe('transformModule', () => {
  describe('module without AI calls', () => {
    let context: Awaited<ReturnType<typeof createProject>>;
    let plugin: Awaited<ReturnType<typeof startPlugin>>;

    beforeAll(async () => {
      context = await createProject(PLAIN_MODULE);
      plugin = await startPlugin(context.root);
    });

    afterAll(async () => {
      callCloseBundle(plugin);
      await context.cleanup();
    });

    it('returns early without touching the TypeScript project', async () => {
      await measure('no AI calls: early return', async () => {
        const result = await callTransform(plugin, PLAIN_MODULE, context.sourcePath);
        if (result !== null) throw new Error('Expected no rewrite for a module without AI calls');
      });
    });
  });

  for (const count of [1, 5, 20]) {
    const label = `${count} AI call${count === 1 ? '' : 's'}`;

    describe(`module with ${label} and a warm cache`, () => {
      const source = moduleWithAiCalls(count);
      let context: Awaited<ReturnType<typeof createProject>>;
      let plugin: Awaited<ReturnType<typeof startPlugin>>;

      beforeAll(async () => {
        context = await createProject(source);
        plugin = await startPlugin(context.root);

        // One real transform fills the cache. Then fetch is blocked so timing never hits the network.
        vi.stubGlobal('fetch', generatedCodeFetch);
        const warm = await callTransform(plugin, source, context.sourcePath) as { code: string } | null;
        vi.stubGlobal('fetch', offlineFetch);

        if (!warm || /\.\w+Ai\(/.test(warm.code)) {
          throw new Error(`Warm-up did not rewrite all ${count} AI calls`);
        }
      });

      afterAll(async () => {
        vi.unstubAllGlobals();
        callCloseBundle(plugin);
        await context.cleanup();
      });

      it(`rewrites ${label} from cache`, async () => {
        await measure(`warm cache: ${label}`, async () => {
          resetAiCallReport();
          const result = await callTransform(plugin, source, context.sourcePath);
          if (!result) throw new Error('Expected a rewrite for a module with AI calls');
        }, { time: 2000 });
      });
    });
  }
});
