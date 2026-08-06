import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { IAtomicFileSystem, writeFileAtomically } from '../main/AtomicFile';

const temporaryDirectories: string[] = [];

async function makeDirectory() {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'yellowfruit-atomic-'));
  temporaryDirectories.push(directory);
  return directory;
}

function fileSystemWithFailure(failure: 'open' | 'write' | 'sync' | 'rename'): IAtomicFileSystem {
  return {
    open: async (filePath, flags, mode) => {
      if (failure === 'open') throw new Error('injected open failure');
      const handle = await fs.promises.open(filePath, flags, mode);
      return {
        writeFile: async (data, encoding) => {
          if (failure === 'write') throw new Error('injected disk-full failure');
          await handle.writeFile(data, { encoding });
        },
        sync: async () => {
          if (failure === 'sync') throw new Error('injected fsync failure');
          await handle.sync();
        },
        close: () => handle.close(),
      };
    },
    rename: async (source, destination) => {
      if (failure === 'rename') throw new Error('injected replace failure');
      await fs.promises.rename(source, destination);
    },
    unlink: (filePath) => fs.promises.unlink(filePath).catch(() => undefined),
    syncDirectory: async () => undefined,
  };
}

describe('atomic file persistence', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    const directories = temporaryDirectories.splice(0);
    await Promise.all(directories.map((directory) => fs.promises.rm(directory, { recursive: true, force: true })));
  });

  test('writes the replacement only after the complete contents are flushed', async () => {
    const directory = await makeDirectory();
    const destination = path.join(directory, 'tournament.yft');
    await fs.promises.writeFile(destination, 'previous complete file', 'utf8');

    await writeFileAtomically(destination, 'new complete file');

    expect(await fs.promises.readFile(destination, 'utf8')).toBe('new complete file');
    const directoryEntries = await fs.promises.readdir(directory);
    expect(directoryEntries).toEqual(['tournament.yft']);
  });

  test.each(['open', 'write', 'sync', 'rename'] as const)('keeps the original file on %s failure', async (failure) => {
    const directory = await makeDirectory();
    const destination = path.join(directory, 'tournament.yft');
    await fs.promises.writeFile(destination, 'previous complete file', 'utf8');

    await expect(
      writeFileAtomically(destination, 'partial replacement', fileSystemWithFailure(failure)),
    ).rejects.toThrow('injected');

    expect(await fs.promises.readFile(destination, 'utf8')).toBe('previous complete file');
    expect((await fs.promises.readdir(directory)).filter((entry) => entry.includes('.tmp'))).toHaveLength(0);
  });

  test('does not report success when the destination cannot be replaced', async () => {
    const directory = await makeDirectory();
    const destination = path.join(directory, 'tournament.yft');
    await fs.promises.writeFile(destination, '{"valid":true}', 'utf8');
    const rename = vi.fn(async () => {
      throw new Error('permission denied');
    });

    await expect(
      writeFileAtomically(destination, '{"valid":false}', {
        ...fileSystemWithFailure('rename'),
        rename,
      }),
    ).rejects.toThrow('permission denied');

    expect(rename).toHaveBeenCalled();
    expect(await fs.promises.readFile(destination, 'utf8')).toBe('{"valid":true}');
  });

  test('Windows replacement failure keeps the original when the backup move is refused', async () => {
    const directory = await makeDirectory();
    const destination = path.join(directory, 'tournament.yft');
    await fs.promises.writeFile(destination, 'previous complete file', 'utf8');
    const base = fileSystemWithFailure('rename');

    await expect(
      writeFileAtomically(destination, 'partial replacement', {
        ...base,
        platform: 'win32',
        rename: async (source, target) => {
          if (source.includes('.tmp') && target === destination) {
            const error = new Error('replacement refused') as Error & { code?: string };
            error.code = 'EEXIST';
            throw error;
          }
          const error = new Error('permission denied') as Error & { code?: string };
          error.code = 'EPERM';
          throw error;
        },
      }),
    ).rejects.toThrow('replacement refused');

    expect(await fs.promises.readFile(destination, 'utf8')).toBe('previous complete file');
  });

  test('Windows replacement restores the original when the second rename fails', async () => {
    const directory = await makeDirectory();
    const destination = path.join(directory, 'tournament.yft');
    await fs.promises.writeFile(destination, 'previous complete file', 'utf8');
    let firstReplacementAttempt = true;
    let secondReplacementAttempt = true;

    const base = fileSystemWithFailure('open');
    await expect(
      writeFileAtomically(destination, 'partial replacement', {
        ...base,
        platform: 'win32',
        open: async (filePath, flags, mode) => {
          const handle = await fs.promises.open(filePath, flags, mode);
          return {
            writeFile: (data, encoding) => handle.writeFile(data, { encoding }),
            sync: () => handle.sync(),
            close: () => handle.close(),
          };
        },
        rename: async (source, target) => {
          if (source.includes('.tmp') && target === destination && firstReplacementAttempt) {
            firstReplacementAttempt = false;
            const error = new Error('replacement refused') as Error & { code?: string };
            error.code = 'EEXIST';
            throw error;
          }
          if (source.includes('.tmp') && target === destination && secondReplacementAttempt) {
            secondReplacementAttempt = false;
            const error = new Error('permission denied') as Error & { code?: string };
            error.code = 'EPERM';
            throw error;
          }
          await fs.promises.rename(source, target);
        },
      }),
    ).rejects.toThrow('permission denied');

    expect(await fs.promises.readFile(destination, 'utf8')).toBe('previous complete file');
  });
});
