import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
    API,
    type Snapshot
} from 'typescript/unstable/sync';
import type { Plugin } from 'vite';
import {
    AI_CONFIG_FILE,
    DEFAULT_GENERATED_DIR,
    DEFAULT_MODEL,
    TSCONFIG_FILE,
    VITE_PLUGIN_NAME
} from './constants.js';
import { createConfigurationError } from './errorContext.js';
import { translate } from './translations/en.js';
import { transformModule } from './transform/transformModule.js';
import type { AIConfig } from './types.js';

/**
 * Creates a Vite plugin that compiles `sortAi`, `filterAi`, `mapAi`, and
 * `reduceAi` array calls into native array operations during the build.
 *
 * The plugin reads `tsconfig.json` and `.ai-rc.json` from Vite's resolved root.
 * The config file must contain an OpenAI `apiKey`; `model`, `cache`, and
 * `generatedDir` are optional and default to `gpt-4.1-mini`, `true`, and
 * `.ai-cache`. On a cache miss, the instruction and inferred type schema are
 * sent to OpenAI, but array contents are not. Generated functions are
 * validated before the call is rewritten.
 *
 * @returns A Vite plugin that performs the AI call transformations.
 *
 * @example Simple Vite setup
 * ```ts
 * import { defineConfig } from 'vite';
 * import { aiCompiler } from 'vite-plugin-ai-lambda';
 *
 * export default defineConfig({
 *   plugins: [aiCompiler()]
 * });
 * ```
 *
 * @example Advanced setup for an application in a monorepo
 * ```ts
 * import { defineConfig } from 'vite';
 * import react from '@vitejs/plugin-react';
 * import { aiCompiler } from 'vite-plugin-ai-lambda';
 *
 * // Keep tsconfig.json and .ai-rc.json in ./apps/store.
 * export default defineConfig({
 *   root: './apps/store',
 *   plugins: [react(), aiCompiler()]
 * });
 *
 * interface Order {
 *   customer: string;
 *   total: number;
 *   status: string;
 * }
 *
 * interface Array<T> {
 *   filterAi(instruction: string): T[];
 *   sortAi(instruction: string): T[];
 *   reduceAi<U>(instruction: string, initialValue: U): U;
 * }
 *
 * const revenue = orders
 *   .filterAi('Keep completed orders only.')
 *   .sortAi('Sort by total from highest to lowest.')
 *   .reduceAi<number>(
 *     'Add each order total to the running revenue.',
 *     0
 *   );
 * ```
 */
export function aiCompiler(): Plugin {
  let config: AIConfig;
  let root: string;
  let tsconfigPath: string;
  let api: API | undefined;
  let initialSnapshot: Snapshot | undefined;

  function getApi(): API {
    if (!api) {
      throw new Error(translate('typescriptApiNotInitialized'));
    }

    return api;
  }

  return {
    name: VITE_PLUGIN_NAME,
    enforce: 'pre',

    async configResolved(resolved) {
      root = resolved.root;
      tsconfigPath = path.resolve(root, TSCONFIG_FILE);
      api = new API();

      try {
        api.parseConfigFile(tsconfigPath);
        initialSnapshot = api.updateSnapshot({
          openProjects: [tsconfigPath]
        });

        const project = initialSnapshot.getProject(tsconfigPath);

        if (!project) {
          throw new Error(translate('unableToLoadTypeScriptProject', {
            tsconfigPath
          }));
        }

        const diagnostics =
          project.program.getConfigFileParsingDiagnostics();

        if (diagnostics.length) {
          throw new Error(
            diagnostics.map((diagnostic) => diagnostic.text).join('\n')
          );
        }

        const configPath = path.resolve(root, AI_CONFIG_FILE);
        config = JSON.parse(await readFile(configPath, 'utf8'));

        if (!config.apiKey) {
          throw new Error(translate('missingApiKey'));
        }

        config.model ||= DEFAULT_MODEL;
        config.cache ??= true;
        config.generatedDir ||= DEFAULT_GENERATED_DIR;
      } catch (error) {
        initialSnapshot?.dispose();
        api.close();
        api = undefined;
        throw createConfigurationError(error, root);
      }
    },

    async transform(source, id) {
      return transformModule(
        source,
        id,
        getApi,
        tsconfigPath,
        config,
        root
      );
    },

    closeBundle() {
      initialSnapshot?.dispose();
      initialSnapshot = undefined;
      api?.close();
      api = undefined;
    },

    closeWatcher() {
      initialSnapshot?.dispose();
      initialSnapshot = undefined;
      api?.close();
      api = undefined;
    }
  };
}
