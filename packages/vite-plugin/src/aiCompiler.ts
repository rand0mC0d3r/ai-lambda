import path from 'node:path';
import {
  API,
  type Snapshot
} from 'typescript/unstable/sync';
import type { Plugin } from 'vite';
import { createFilter, type Logger } from 'vite';
import {
    AI_CONFIG_FILE,
    TSCONFIG_FILE,
    VITE_PLUGIN_NAME
} from './constants.js';
import { readAiConfig } from './config.js';
import { createConfigurationError } from './errorContext.js';
import { translate } from './translations/en.js';
import { transformModule } from './transform/transformModule.js';
import type { AIConfig } from './types.js';

const shouldTransform = createFilter(/\.[jt]sx?$/, [/node_modules/, /\0/]);

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
  let logger: Logger;
  let api: API | undefined;
  let initialSnapshot: Snapshot | undefined;

  function getApi(): API {
    if (!api) {
      throw new Error(translate('typescriptApiNotInitialized'));
    }

    return api;
  }

  function disposeTypeScript(): void {
    initialSnapshot?.dispose();
    initialSnapshot = undefined;
    api?.close();
    api = undefined;
  }

  return {
    name: VITE_PLUGIN_NAME,
    enforce: 'pre',

    async configResolved(resolved) {
      root = resolved.root;
      logger = resolved.logger;
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
        config = await readAiConfig(configPath, root);
      } catch (error) {
        disposeTypeScript();
        throw createConfigurationError(error, root);
      }
    },

    async transform(source, id) {
      if (!shouldTransform(id)) return null;

      return transformModule(
        source,
        id,
        getApi,
        tsconfigPath,
        config,
        root,
        logger
      );
    },

    closeBundle() {
      // Watch builds call closeBundle after every rebuild, so keep the API alive.
      if (!this.meta.watchMode) {
        disposeTypeScript();
      }
    },
    closeWatcher: disposeTypeScript
  };
}
