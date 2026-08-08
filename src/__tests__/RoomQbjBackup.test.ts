/**
 * The file a scorekeeper hands over when nothing else worked.
 *
 * Two properties, and they fail in opposite directions. A filename that does not say which game it
 * is turns six recovered results into a puzzle; a payload that carries a room token turns a USB
 * stick into a credential leak. Both are silent until they are not.
 */
import { describe, expect, test } from 'vitest';
import {
  outboxQbjFileContents,
  outboxQbjFileName,
  sanitizeFileNamePart,
  sanitizeQbjForDownload,
} from '../room/QbjBackup';

describe('the downloaded filename', () => {
  test('names the round, the room and the teams', () => {
    const name = outboxQbjFileName(
      { roundNumber: 4, roundName: '4', leftTeam: 'Ninety Six A', rightTeam: 'Greenwood' },
      'Room 204',
    );

    expect(name).toBe('R04_Room-204_Ninety-Six-A_vs_Greenwood.qbj');
  });

  test('pads the round so a directory listing sorts into playing order', () => {
    const early = outboxQbjFileName({ roundNumber: 4, leftTeam: 'A', rightTeam: 'B' });
    const late = outboxQbjFileName({ roundNumber: 11, leftTeam: 'A', rightTeam: 'B' });

    expect([late, early].sort()).toEqual([early, late]);
  });

  test('leaves the room out rather than inventing one', () => {
    expect(outboxQbjFileName({ roundNumber: 4, leftTeam: 'A', rightTeam: 'B' })).toBe('R04_A_vs_B.qbj');
  });

  test('a team name full of punctuation still produces a usable filename', () => {
    const name = outboxQbjFileName(
      { roundNumber: 2, leftTeam: 'St. Mary’s / Team #1', rightTeam: '..\\..\\etc' },
      'Room: 3',
    );

    expect(name).toBe('R02_Room-3_St-Mary-s-Team-1_vs_etc.qbj');
    expect(name).not.toMatch(/[/\\:*?"<>|]/);
  });

  test('an empty name falls back rather than producing a bare separator', () => {
    expect(sanitizeFileNamePart('   ', 'Team-1')).toBe('Team-1');
    expect(sanitizeFileNamePart('!!!', 'Team-2')).toBe('Team-2');
  });
});

describe('the downloaded payload', () => {
  test('is the game result and nothing else', () => {
    const sanitized = sanitizeQbjForDownload({
      match_teams: [{ team: { name: 'Ninety Six A' } }, { team: { name: 'Greenwood' } }],
      tossups_read: 20,
      // None of these are produced by MODAQ today. They are here because the cost of one of them
      // appearing later and travelling on a USB stick is a room credential in the wild.
      accessToken: 'room-token',
      sessionCredentials: { sessionId: 's', token: 't' },
      device_id: 'device-abc',
      notes: { pairing_code: '12345678', text: 'kept' },
    }) as Record<string, unknown>;

    expect(sanitized.match_teams).toHaveLength(2);
    expect(sanitized.tossups_read).toBe(20);
    expect(sanitized).not.toHaveProperty('accessToken');
    expect(sanitized).not.toHaveProperty('sessionCredentials');
    expect(sanitized).not.toHaveProperty('device_id');
    expect(sanitized.notes).toEqual({ text: 'kept' });
  });

  test('sanitizing does not modify the payload the outbox will upload', () => {
    const original = { match_teams: [], token: 'secret' };

    sanitizeQbjForDownload(original);

    expect(original.token).toBe('secret');
  });

  test('the file is readable JSON', () => {
    const contents = outboxQbjFileContents({ qbj: { match_teams: [{ team: { name: 'A' } }] } });

    expect(JSON.parse(contents)).toEqual({ match_teams: [{ team: { name: 'A' } }] });
  });
});
