/**
 * A second copy of the tournament file, somewhere that is not this computer's disk.
 *
 * The failure this exists for is the one nothing else in YellowFruit can survive: the laptop
 * running the tournament stops working. Atomic writes protect the .yft from a crash mid-save;
 * they do not protect it from a dead SSD, a spilled drink, or a machine that will not boot after
 * lunch. A USB stick, a synced folder, or a share on another machine does.
 *
 * Two rules shape everything here. The primary save is authoritative and this is not: a secondary
 * write that fails must never make a successful Save look like a failure, must never leave the
 * tournament dirty, and must never block anything. And YellowFruit only ever deletes files it
 * created: a director will point this at a USB stick with other things on it, and rotation that
 * tidies up someone else's folder is a far worse bug than one that leaves too many backups.
 *
 * What lands in the folder is an ordinary .yft — the same bytes the primary save wrote. It opens
 * on a replacement computer with File > Open and nothing else. No transient state, no session data,
 * no wrapper format to unpick under pressure.
 */
import fs from 'fs';
import path from 'path';
import { writeFileAtomically } from './AtomicFile';
import {
  ISecondaryBackupHealth,
  backupRetentionLimit,
  emptyBackupHealth,
  selectBackupsToRemove,
  timestampedBackupFileName,
  currentBackupFileName,
} from '../shared/BackupTypes';

export * from '../shared/BackupTypes';

export type SecondaryBackupOutcome =
  | { ok: true; folder: string; fileName: string; removed: string[] }
  | { ok: false; error: string };

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error !== '') return error;
  return 'The backup folder could not be written to.';
}

/**
 * Write one redundant copy and rotate the folder.
 *
 * The snapshot is written before `Current.yft` is replaced, so a folder is never left with a
 * `Current.yft` that no snapshot backs up. Both writes go through the same atomic writer the
 * primary save uses, which matters more here than there: a USB stick is exactly the device someone
 * pulls out mid-write.
 *
 * Rotation runs last and its failures are not fatal — an un-pruned folder is a tidiness problem,
 * whereas reporting a failure for a backup that actually landed would send a director looking for a
 * file that is already there.
 */
export async function writeSecondaryBackup(
  folder: string,
  contents: string,
  when: Date = new Date(),
  limit: number = backupRetentionLimit,
): Promise<SecondaryBackupOutcome> {
  if (folder === '') return { ok: false, error: 'No backup folder has been chosen.' };

  const fileName = timestampedBackupFileName(when);
  try {
    await fs.promises.mkdir(folder, { recursive: true });
    await writeFileAtomically(path.join(folder, fileName), contents);
    await writeFileAtomically(path.join(folder, currentBackupFileName), contents);
  } catch (error: unknown) {
    return { ok: false, error: messageOf(error) };
  }

  const removed: string[] = [];
  try {
    const present = await fs.promises.readdir(folder);
    for (const candidate of selectBackupsToRemove(present, limit)) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await fs.promises.unlink(path.join(folder, candidate));
        removed.push(candidate);
      } catch {
        // A file that will not delete stays. It is a copy of a tournament; leaving it is safe.
      }
    }
  } catch {
    // Listing the folder failed after both writes landed. The backup is good; say nothing.
  }

  return { ok: true, folder, fileName, removed };
}

/**
 * Owns the configured folder and the health the director sees.
 *
 * A class rather than loose functions because the health has to survive between saves and be
 * readable by the renderer on demand, and because a retry needs the last contents that failed.
 */
export default class SecondaryBackupManager {
  private folder: string | null = null;

  private health: ISecondaryBackupHealth = emptyBackupHealth();

  /**
   * The last thing we tried and failed to write.
   *
   * Retained so Retry means "try that again" rather than "wait for the next save", which is what a
   * director pressing it after plugging the USB stick back in actually wants.
   */
  private pendingContents: string | null = null;

  /** Serialize writes so a fast Save-Save cannot interleave two rotations. */
  private writeChain: Promise<void> = Promise.resolve();

  private onHealthChanged: (health: ISecondaryBackupHealth) => void;

  constructor(onHealthChanged: (health: ISecondaryBackupHealth) => void = () => {}) {
    this.onHealthChanged = onHealthChanged;
  }

  getHealth(): ISecondaryBackupHealth {
    return { ...this.health };
  }

  getFolder(): string | null {
    return this.folder;
  }

  /** Point backups at a folder, or turn them off with null. */
  setFolder(folder: string | null) {
    this.folder = folder && folder !== '' ? folder : null;
    this.health = { ...emptyBackupHealth(), folder: this.folder };
    this.pendingContents = null;
    this.onHealthChanged(this.getHealth());
  }

  /** True when there is a failure the director could usefully retry. */
  canRetry(): boolean {
    return this.folder !== null && this.pendingContents !== null && this.health.lastError !== null;
  }

  /**
   * Queue a redundant copy after a primary save.
   *
   * Returns a promise for tests and for the retry path. Production callers deliberately do not
   * await it: the primary save has already succeeded and the renderer has already been told, and
   * making Save wait on a network share would be a worse bug than any this feature fixes.
   */
  backup(contents: string, when: Date = new Date()): Promise<void> {
    if (this.folder === null) return Promise.resolve();
    const { folder } = this;
    this.pendingContents = contents;
    this.writeChain = this.writeChain
      .catch(() => undefined)
      .then(async () => {
        const outcome = await writeSecondaryBackup(folder, contents, when);
        this.health = {
          folder,
          lastAttemptAt: when.toISOString(),
          lastSuccessAt: outcome.ok ? when.toISOString() : this.health.lastSuccessAt,
          lastError: outcome.ok ? null : outcome.error,
        };
        if (outcome.ok) this.pendingContents = null;
        this.onHealthChanged(this.getHealth());
        return undefined;
      });
    return this.writeChain;
  }

  /** Try the last failed copy again, for the case where the drive has come back. */
  retry(when: Date = new Date()): Promise<void> {
    if (this.folder === null || this.pendingContents === null) return Promise.resolve();
    return this.backup(this.pendingContents, when);
  }
}
