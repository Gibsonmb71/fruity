import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';

/** The small filesystem surface needed by the atomic writer. Keeping it injectable makes every
 * persistence boundary testable without depending on a real disk failure. */
export interface IAtomicFileHandle {
  writeFile(data: string, encoding: 'utf8'): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

export interface IAtomicFileSystem {
  open(filePath: string, flags: string, mode?: number): Promise<IAtomicFileHandle>;
  rename(source: string, destination: string): Promise<void>;
  unlink(filePath: string): Promise<void>;
  syncDirectory?(directory: string): Promise<void>;
  /** Injectable for exercising the Windows replacement path on POSIX CI. */
  platform?: string;
}

const realFileSystem: IAtomicFileSystem = {
  open: async (filePath, flags, mode) => {
    const handle = await fs.promises.open(filePath, flags, mode);
    return {
      writeFile: (data, encoding) => handle.writeFile(data, { encoding }),
      sync: () => handle.sync(),
      close: () => handle.close(),
    };
  },
  rename: (source, destination) => fs.promises.rename(source, destination),
  unlink: (filePath) => fs.promises.unlink(filePath),
  syncDirectory: async (directory) => {
    // Directory fsync is useful on POSIX after the rename. Windows does not allow opening a
    // directory this way, so the platform-specific failure is intentionally best effort.
    try {
      const directoryHandle = await fs.promises.open(directory, 'r');
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
    } catch (error) {
      if (process.platform !== 'win32') throw error;
    }
  },
};

function temporaryPathFor(filePath: string): string {
  const directory = path.dirname(filePath);
  const basename = path.basename(filePath);
  return path.join(directory, `.${basename}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`);
}

function replacementBackupPathFor(filePath: string): string {
  const directory = path.dirname(filePath);
  const basename = path.basename(filePath);
  return path.join(directory, `.${basename}.${process.pid}.${randomBytes(8).toString('hex')}.bak`);
}

function isWindowsReplacementError(error: unknown, platform: string): boolean {
  const code = (error as { code?: string } | null)?.code;
  return platform === 'win32' && (code === 'EEXIST' || code === 'EPERM' || code === 'EBUSY');
}

async function tryUnlink(filePath: string, fileSystem: IAtomicFileSystem): Promise<void> {
  try {
    await fileSystem.unlink(filePath);
  } catch {
    // Cleanup must never hide the original persistence failure.
  }
}

/**
 * Write a complete file beside the destination, flush it, and replace the destination only after
 * the new contents are durable. The normal path is a same-directory rename, which is atomic on
 * the filesystems YellowFruit supports. Windows may reject replacement of an existing path; in
 * that case the OS-compatible fallback keeps a completed temporary file and performs the replace
 * only after the write/flush phase has succeeded.
 */
export async function writeFileAtomically(
  filePath: string,
  contents: string,
  fileSystem: IAtomicFileSystem = realFileSystem,
): Promise<void> {
  const temporaryPath = temporaryPathFor(filePath);
  let handle: IAtomicFileHandle | undefined;
  const platform = fileSystem.platform ?? process.platform;
  try {
    handle = await fileSystem.open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;

    try {
      await fileSystem.rename(temporaryPath, filePath);
    } catch (error) {
      if (!isWindowsReplacementError(error, platform)) throw error;

      // Windows can refuse to rename over an existing destination. Move the old complete file to
      // a same-directory backup first, install the flushed replacement, and restore the backup if
      // the second rename fails. This retains the old file on ordinary permission/replace errors;
      // unlike unlink-then-rename, a failed replacement cannot silently erase it.
      const backupPath = replacementBackupPathFor(filePath);
      let movedOriginal = false;
      let backupCanBeCleaned = true;
      try {
        try {
          await fileSystem.rename(filePath, backupPath);
          movedOriginal = true;
        } catch (backupError) {
          const backupCode = (backupError as { code?: string } | null)?.code;
          if (backupCode !== 'ENOENT') throw error;
        }

        await fileSystem.rename(temporaryPath, filePath);
      } catch (replacementError) {
        if (movedOriginal) {
          try {
            await fileSystem.rename(backupPath, filePath);
          } catch {
            // Preserve the replacement error, but keep the backup in place if the restore also
            // fails so the last complete file remains recoverable by an operator.
            backupCanBeCleaned = false;
          }
        }
        throw replacementError;
      } finally {
        if (backupCanBeCleaned) await tryUnlink(backupPath, fileSystem);
      }
    }

    if (fileSystem.syncDirectory) await fileSystem.syncDirectory(path.dirname(filePath));
  } finally {
    if (handle) {
      try {
        await handle.close();
      } catch {
        // Preserve the original write/flush error.
      }
    }
    await tryUnlink(temporaryPath, fileSystem);
  }
}

/** Used by tests and recovery diagnostics to prove the writer's temporary naming contract. */
export function atomicTemporaryPathFor(filePath: string): string {
  return temporaryPathFor(filePath);
}
