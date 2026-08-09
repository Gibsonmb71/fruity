/**
 * Settings that belong to this installation rather than to a tournament.
 *
 * The line is the same one the .yft file draws everywhere else: a tournament file describes a
 * tournament, and it travels — to a co-director's laptop, into a QBJ export, into an SQBS file for
 * a stats archive. The path to a USB stick on this particular machine is none of those things. Put
 * it in the .yft and it becomes a stale path on every other computer that opens the file, and a
 * piece of somebody's directory structure in a published export.
 *
 * So this is a small JSON file in the OS's application-data directory, read once and written on
 * change, holding only things that are true of this computer.
 */
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { writeFileAtomically } from './AtomicFile';

export interface IAppPreferences {
  /** Where redundant .yft copies are written, or undefined when the feature is off. */
  secondaryBackupFolder?: string;
  /** Static QBSheet origin allowed to call the local tournament API. */
  qbsheetOrigin?: string;
}

export type AppPreferencesUpdateResult =
  | { ok: true; preferences: IAppPreferences }
  | { ok: false; preferences: IAppPreferences; error: string };

function preferencesPath(): string {
  return path.join(app.getPath('userData'), 'preferences.json');
}

let cached: IAppPreferences | null = null;

/** Serialize preference replacements so rapid changes cannot finish out of order. */
let preferenceWritePromise: Promise<void> = Promise.resolve();

/** Read the preferences, treating a missing or damaged file as "no preferences set". */
export function readAppPreferences(): IAppPreferences {
  if (cached) return { ...cached };
  let value: IAppPreferences = {};
  try {
    const raw = fs.readFileSync(preferencesPath(), { encoding: 'utf8' });
    const parsed = JSON.parse(raw) as Partial<IAppPreferences>;
    if (typeof parsed?.secondaryBackupFolder === 'string' && parsed.secondaryBackupFolder !== '') {
      value = { secondaryBackupFolder: parsed.secondaryBackupFolder };
    }
    const legacyOrigin = (parsed as Partial<IAppPreferences> & { standaloneScorekeeperOrigin?: unknown })
      ?.standaloneScorekeeperOrigin;
    const origin = typeof parsed?.qbsheetOrigin === 'string' ? parsed.qbsheetOrigin : legacyOrigin;
    if (typeof origin === 'string' && origin !== '') {
      value.qbsheetOrigin = origin;
    }
  } catch {
    // Nothing here is worth failing startup over. A director who has lost the backup folder setting
    // is told the feature is off, and can set it again in one click.
  }
  cached = value;
  return { ...value };
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error !== '') return error;
  return 'Application preferences could not be saved.';
}

/** Merge a change into the preferences and write them atomically. */
export async function updateAppPreferences(change: Partial<IAppPreferences>): Promise<AppPreferencesUpdateResult> {
  const next: IAppPreferences = { ...readAppPreferences(), ...change };
  if (next.secondaryBackupFolder === undefined || next.secondaryBackupFolder === '') {
    delete next.secondaryBackupFolder;
  }
  if (next.qbsheetOrigin === undefined || next.qbsheetOrigin === '') {
    delete next.qbsheetOrigin;
  }
  // The setting still takes effect for this session even if persistence fails. Callers get the
  // failure explicitly so the renderer can tell the director it will not survive a restart.
  cached = next;
  const write = preferenceWritePromise
    .catch(() => undefined)
    .then(() => writeFileAtomically(preferencesPath(), JSON.stringify(next)));
  preferenceWritePromise = write;
  try {
    await write;
    return { ok: true, preferences: { ...next } };
  } catch (error: unknown) {
    return { ok: false, preferences: { ...next }, error: messageOf(error) };
  }
}
