import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';
import { translate } from '../src/translations/en.js';

export async function createProject(
  source: string,
  config: Record<string, unknown> = { apiKey: 'test-key' }
): Promise<{ root: string; sourcePath: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(path.join(tmpdir(), 'ai-lambda-test-'));
  const sourcePath = path.join(root, 'fixture.ts');

  await writeFile(
    path.join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        target: 'ES2023',
        module: 'ESNext',
        moduleResolution: 'Bundler'
      },
      include: ['fixture.ts']
    })
  );
  await writeFile(path.join(root, '.ai-rc.json'), JSON.stringify(config));
  await writeFile(sourcePath, source);

  return {
    root,
    sourcePath,
    cleanup: () => rm(root, { recursive: true, force: true })
  };
}

export async function callConfigResolved(
  plugin: Plugin,
  root: string
): Promise<void> {
  const hook = plugin.configResolved;

  if (!hook) throw new Error(translate('missingConfigResolvedHook'));

  const handler = typeof hook === 'function' ? hook : hook.handler;
  await handler.call(plugin, { root } as ResolvedConfig);
}

export async function callTransform(
  plugin: Plugin,
  source: string,
  id: string
): Promise<unknown> {
  const hook = plugin.transform;

  if (!hook) throw new Error(translate('missingTransformHook'));

  const handler = typeof hook === 'function' ? hook : hook.handler;
  return handler.call(plugin, source, id);
}
