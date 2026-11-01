import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Logger, Plugin, ResolvedConfig } from 'vite';
import { describe, expect, it, vi } from 'vitest';
import { aiCompiler } from '../src/aiCompiler.js';
import { finishAiCall, resetAiCallReport, startAiCall } from '../src/reporting/aiCallReport.js';
import {
  callCloseBundle,
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

  it('keeps the TypeScript API alive across watch-mode rebuilds', async () => {
    const project = await createProject('const value = 1;');
    const plugin = aiCompiler();
    await callConfigResolved(plugin, project.root);

    try {
      callCloseBundle(plugin, true);
      await expect(
        callTransform(
          plugin,
          "const result = items.sortAi('ascending');",
          '/project/other.ts'
        )
      ).rejects.not.toThrow('TypeScript API is not initialized');
    } finally {
      callCloseBundle(plugin);
      await project.cleanup();
    }
  });

  it('prints the dev-server summary once AI activity settles', async () => {
    vi.useFakeTimers();
    const project = await createProject('const value = 1;');
    const plugin = aiCompiler();
    const info = vi.fn();
    const logger = { info, warn: vi.fn(), error: vi.fn() } as unknown as Logger;

    try {
      const configResolved = plugin.configResolved as (
        this: Plugin,
        config: ResolvedConfig
      ) => Promise<void>;
      await configResolved.call(plugin, {
        root: project.root,
        logger,
        command: 'serve'
      } as unknown as ResolvedConfig);

      startAiCall();
      finishAiCall({
        method: 'filterAi',
        instruction: 'Keep active items',
        model: 'gpt-4.1-mini',
        outcome: 'generated',
        durationMs: 100,
        attempts: 1
      });

      await callTransform(plugin, 'const value = 1;', path.join(project.root, 'test.ts'));
      expect(info).not.toHaveBeenCalled();

      vi.advanceTimersByTime(2000);
      expect(info).toHaveBeenCalledWith(expect.stringContaining('AI compile summary'));
    } finally {
      plugin.closeWatcher?.call(plugin);
      vi.useRealTimers();
      resetAiCallReport();
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
