import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { aiCompiler } from '../src/aiCompiler.js';
import {
  callConfigResolved,
  callTransform,
  createProject
} from './helpers.js';

describe('aiCompiler', () => {
  it('requires project configuration and a configured API key', async () => {
    const missingKey = await createProject('const value = 1;', {});

    try {
      await expect(
        callConfigResolved(aiCompiler(), missingKey.root)
      ).rejects.toThrow('Missing OpenAI API key');
    } finally {
      await missingKey.cleanup();
    }

    const plugin = aiCompiler();
    await expect(
      callTransform(plugin, 'const value = 1;', '/project/test.ts')
    ).resolves.toBeNull();
    await expect(
      callTransform(
        plugin,
        "const result = items.sortAi('ascending');",
        '/project/test.ts'
      )
    ).rejects.toThrow('TypeScript API is not initialized');
  });

  it('reports TypeScript configuration diagnostics', async () => {
    const project = await createProject('const value = 1;');

    try {
      await writeFile(path.join(project.root, 'tsconfig.json'), '{ invalid');
      await expect(
        callConfigResolved(aiCompiler(), project.root)
      ).rejects.toThrow('Failed to initialize');
    } finally {
      await project.cleanup();
    }
  });

  it('releases the TypeScript API on watcher shutdown', async () => {
    const project = await createProject('const value = 1;');
    const plugin = aiCompiler();
    await callConfigResolved(plugin, project.root);

    try {
      plugin.closeWatcher?.call(plugin);
      await expect(
        callTransform(
          plugin,
          "const result = items.sortAi('ascending');",
          '/project/other.ts'
        )
      ).rejects.toThrow('TypeScript API is not initialized');
    } finally {
      await project.cleanup();
    }
  });
});
