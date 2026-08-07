/**
 * The second copy of the tournament file.
 *
 * Two things have to be true at once and they pull against each other. The backup has to actually
 * happen, on a USB stick that may be unplugged at any moment — and it has to be completely unable
 * to affect the primary save, which is the thing the tournament actually depends on. Most of these
 * tests are about the second half: what happens when the folder goes away.
 *
 * The rotation tests are about the other way this feature could do damage. A director points this
 * at a USB stick that already has things on it, and a tidy-up that removes files YellowFruit did
 * not create would be far worse than one that leaves too many backups.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import SecondaryBackupManager, { writeSecondaryBackup } from '../main/SecondaryBackup';
import {
  currentBackupFileName,
  isRotatableBackupFileName,
  selectBackupsToRemove,
  timestampedBackupFileName,
} from '../shared/BackupTypes';

let folder: string;

beforeEach(() => {
  folder = mkdtempSync(path.join(tmpdir(), 'yf-backup-'));
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

/** Stand-in for a real .yft: what matters here is that the exact bytes come back. */
const tournamentJson = JSON.stringify({ version: '2.1.1', objects: [{ name: 'Ninety Six Invitational' }] });

function at(iso: string): Date {
  return new Date(iso);
}

describe('writing a redundant copy', () => {
  test('writes a timestamped snapshot and a Current.yft with the same bytes', async () => {
    const outcome = await writeSecondaryBackup(folder, tournamentJson, at('2026-08-07T10:42:00'));

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.fileName).toBe('2026-08-07_104200.yft');
    expect(readFileSync(path.join(folder, outcome.fileName), 'utf8')).toBe(tournamentJson);
    expect(readFileSync(path.join(folder, currentBackupFileName), 'utf8')).toBe(tournamentJson);
  });

  test('each copy is an ordinary .yft with no wrapper around it', async () => {
    await writeSecondaryBackup(folder, tournamentJson, at('2026-08-07T10:42:00'));

    // A replacement computer opens this with File > Open. Anything that needed unwrapping under
    // pressure would defeat the point of having it.
    const parsed = JSON.parse(readFileSync(path.join(folder, currentBackupFileName), 'utf8'));
    expect(parsed).toEqual({ version: '2.1.1', objects: [{ name: 'Ninety Six Invitational' }] });
  });

  test('creates the folder if it is missing', async () => {
    const nested = path.join(folder, 'YellowFruit backups');

    const outcome = await writeSecondaryBackup(nested, tournamentJson, at('2026-08-07T10:42:00'));

    expect(outcome.ok).toBe(true);
    expect(existsSync(path.join(nested, currentBackupFileName))).toBe(true);
  });

  test('a folder that cannot be written to is reported rather than thrown', async () => {
    // A file where the folder should be is the closest stand-in for an unplugged drive that works
    // identically on every platform CI runs on.
    const blocked = path.join(folder, 'not-a-folder');
    writeFileSync(blocked, 'occupied');

    const outcome = await writeSecondaryBackup(blocked, tournamentJson, at('2026-08-07T10:42:00'));

    expect(outcome.ok).toBe(false);
  });
});

describe('rotation', () => {
  test('keeps the newest snapshots and removes the rest', () => {
    const names = ['2026-08-07_100000.yft', '2026-08-07_101000.yft', '2026-08-07_102000.yft', '2026-08-07_103000.yft'];

    expect(selectBackupsToRemove(names, 2)).toEqual(['2026-08-07_101000.yft', '2026-08-07_100000.yft']);
  });

  test('never selects a file YellowFruit did not create', () => {
    const names = [
      'Current.yft',
      'Regionals-final.yft',
      'notes.txt',
      'photos',
      '2026-08-07_100000.yft',
      '2026-08-07_101000.yft',
    ];

    expect(selectBackupsToRemove(names, 1)).toEqual(['2026-08-07_100000.yft']);
  });

  test('the name pattern is exact', () => {
    expect(isRotatableBackupFileName(timestampedBackupFileName(at('2026-08-07T10:42:00')))).toBe(true);
    expect(isRotatableBackupFileName('Current.yft')).toBe(false);
    expect(isRotatableBackupFileName('2026-08-07_104200.qbj')).toBe(false);
    expect(isRotatableBackupFileName('copy of 2026-08-07_104200.yft')).toBe(false);
    expect(isRotatableBackupFileName('2026-8-7_104200.yft')).toBe(false);
  });

  test('the folder is bounded after many saves, and unrelated files survive', async () => {
    writeFileSync(path.join(folder, 'Regionals-final.yft'), 'someone else’s tournament');
    writeFileSync(path.join(folder, 'notes.txt'), 'do not delete');

    for (let minute = 0; minute < 6; minute += 1) {
      // eslint-disable-next-line no-await-in-loop
      await writeSecondaryBackup(folder, tournamentJson, at(`2026-08-07T10:0${minute}:00`), 3);
    }

    const present = readdirSync(folder).sort();
    expect(present.filter(isRotatableBackupFileName)).toEqual([
      '2026-08-07_100300.yft',
      '2026-08-07_100400.yft',
      '2026-08-07_100500.yft',
    ]);
    expect(present).toContain('Regionals-final.yft');
    expect(present).toContain('notes.txt');
    expect(present).toContain(currentBackupFileName);
  });
});

describe('health, and staying out of the primary save’s way', () => {
  test('a successful backup records where and when', async () => {
    const manager = new SecondaryBackupManager();
    manager.setFolder(folder);

    await manager.backup(tournamentJson, at('2026-08-07T10:42:00'));

    const health = manager.getHealth();
    expect(health.folder).toBe(folder);
    expect(health.lastError).toBeNull();
    expect(health.lastSuccessAt).toBe(at('2026-08-07T10:42:00').toISOString());
  });

  test('a failure records the error and does not throw at the caller', async () => {
    const manager = new SecondaryBackupManager();
    const blocked = path.join(folder, 'not-a-folder');
    writeFileSync(blocked, 'occupied');
    manager.setFolder(blocked);

    // The production caller does not await this. Awaiting here only proves it settles rather than
    // rejects — a rejection would become an unhandled rejection in the main process.
    await expect(manager.backup(tournamentJson, at('2026-08-07T10:42:00'))).resolves.toBeUndefined();

    expect(manager.getHealth().lastError).not.toBeNull();
    expect(manager.getHealth().lastSuccessAt).toBeNull();
    expect(manager.canRetry()).toBe(true);
  });

  test('a retry after the drive comes back writes the copy that failed', async () => {
    const manager = new SecondaryBackupManager();
    const target = path.join(folder, 'usb');
    writeFileSync(target, 'the drive is not mounted');
    manager.setFolder(target);
    await manager.backup(tournamentJson, at('2026-08-07T10:42:00'));
    expect(manager.getHealth().lastError).not.toBeNull();

    // The drive comes back: the path is a real folder again.
    rmSync(target);
    await manager.retry(at('2026-08-07T10:45:00'));

    expect(manager.getHealth().lastError).toBeNull();
    expect(manager.getHealth().lastSuccessAt).toBe(at('2026-08-07T10:45:00').toISOString());
    // The contents recovered are the ones from the save that failed, not an empty file.
    expect(readFileSync(path.join(target, currentBackupFileName), 'utf8')).toBe(tournamentJson);
  });

  test('a folder that disappears mid-tournament fails only the backup', async () => {
    const manager = new SecondaryBackupManager();
    const target = path.join(folder, 'usb');
    manager.setFolder(target);
    await manager.backup(tournamentJson, at('2026-08-07T10:00:00'));
    expect(manager.getHealth().lastSuccessAt).not.toBeNull();

    rmSync(target, { recursive: true, force: true });
    writeFileSync(target, 'the drive was replaced by a file');
    await manager.backup(tournamentJson, at('2026-08-07T10:10:00'));

    const health = manager.getHealth();
    expect(health.lastError).not.toBeNull();
    // The last good backup is still reported, so a director knows how far back they are covered.
    expect(health.lastSuccessAt).toBe(at('2026-08-07T10:00:00').toISOString());
  });

  test('turning backups off clears the folder and the health', async () => {
    const manager = new SecondaryBackupManager();
    manager.setFolder(folder);
    await manager.backup(tournamentJson, at('2026-08-07T10:42:00'));

    manager.setFolder(null);

    expect(manager.getHealth()).toEqual({
      folder: null,
      lastSuccessAt: null,
      lastAttemptAt: null,
      lastError: null,
    });
    // And nothing is written for later saves.
    await manager.backup(tournamentJson, at('2026-08-07T10:50:00'));
    expect(manager.getHealth().lastAttemptAt).toBeNull();
  });

  test('health changes are announced, so the director sees a failure without asking', async () => {
    const seen: (string | null)[] = [];
    const manager = new SecondaryBackupManager((health) => seen.push(health.lastError));
    manager.setFolder(folder);

    await manager.backup(tournamentJson, at('2026-08-07T10:42:00'));

    expect(seen).toEqual([null, null]);
  });
});
