/**
 * The parts of the redundant-backup feature that both processes need to agree on.
 *
 * Split out from the writer because the renderer has to show the health and the file naming, and
 * must not drag `fs` into its bundle to do it. Everything here is pure: names, limits, and the
 * retention rule.
 */

/**
 * The always-current copy.
 *
 * Named so that a director who has just lost the primary machine does not have to work out which
 * of eleven timestamps is newest while ten people wait.
 */
export const currentBackupFileName = 'Current.yft';

/**
 * How many timestamped snapshots to keep.
 *
 * Fixed rather than configurable: it is a bound on disk use, not a tournament decision, and a USB
 * stick holds far more than ten copies of any realistic .yft. `Current.yft` is not one of these and
 * is never rotated away.
 */
export const backupRetentionLimit = 10;

/** `2026-08-07_104200.yft` — sortable, unambiguous, and legal on every filesystem. */
const timestampedBackupPattern = /^\d{4}-\d{2}-\d{2}_\d{6}\.yft$/;

/** Health of the redundant copy, as the director's status area shows it. */
export interface ISecondaryBackupHealth {
  /** Where copies are being written, or null when the feature is off. */
  folder: string | null;
  /** ISO 8601 of the last copy that landed. */
  lastSuccessAt: string | null;
  /** ISO 8601 of the last attempt, successful or not. */
  lastAttemptAt: string | null;
  /** Why the last attempt failed. Null once one succeeds. */
  lastError: string | null;
}

export function emptyBackupHealth(): ISecondaryBackupHealth {
  return { folder: null, lastSuccessAt: null, lastAttemptAt: null, lastError: null };
}

export function timestampedBackupFileName(when: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const date = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
  const time = `${pad(when.getHours())}${pad(when.getMinutes())}${pad(when.getSeconds())}`;
  return `${date}_${time}.yft`;
}

/**
 * Is this a file YellowFruit put here?
 *
 * The only thing rotation is allowed to delete. Deliberately strict: an exact timestamp shape and
 * nothing else. `Current.yft` is excluded because it is never rotated, and a director's own
 * `Regionals-final.yft` sitting in the same folder does not match and never will.
 */
export function isRotatableBackupFileName(name: string): boolean {
  return timestampedBackupPattern.test(name);
}

/**
 * Which snapshots rotation should remove, newest kept.
 *
 * A pure function over the names so the retention rule can be read and tested without a
 * filesystem — and so it is plain from the signature that nothing outside this list can be chosen.
 * Names sort correctly as strings because the timestamp format was chosen for exactly that.
 */
export function selectBackupsToRemove(fileNames: string[], limit: number = backupRetentionLimit): string[] {
  return fileNames
    .filter(isRotatableBackupFileName)
    .sort((left, right) => right.localeCompare(left))
    .slice(Math.max(0, limit));
}
