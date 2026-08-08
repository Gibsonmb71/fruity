/**
 * The one small record that makes an offline reload possible.
 *
 * Its whole job is to be found again by a browser that cannot ask anybody anything, so what is
 * checked here is mostly what it refuses: another room's game, another tournament's game, a
 * yesterday's game, and a half-written one. Each of those, adopted by mistake, puts a scorekeeper
 * in front of a scoresheet for a game nobody is playing.
 */
import { describe, expect, test } from 'vitest';
import {
  activeRoomGameMaxAgeMs,
  activeRoomGameVersion,
  clearActiveGame,
  IActiveRoomGame,
  readActiveGame,
  touchActiveGame,
  writeActiveGame,
} from '../room/ActiveGameRecord';
import { IRoomMatchup } from '../main/server/ServerTypes';
import { ScheduledMatchStatus } from '../renderer/DataModel/ScheduledMatch';
import scoringRulesToScorekeeperFormat from '../renderer/Services/ScorekeeperFormat';
import { CommonRuleSets, ScoringRules } from '../renderer/DataModel/ScoringRules';

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    map,
  };
}

const matchup: IRoomMatchup = {
  scheduledMatchId: 'sched-4',
  roundNumber: 4,
  roundName: 'Round 4',
  leftTeam: { name: 'Ninety Six', players: [{ name: 'Sarah Mitchell' }] },
  rightTeam: { name: 'Greenwood', players: [{ name: 'Emma Turner' }] },
  status: ScheduledMatchStatus.Playing,
};

const format = scoringRulesToScorekeeperFormat(new ScoringRules(CommonRuleSets.AcfPowers));

function draft(overrides: Partial<IActiveRoomGame> = {}) {
  return {
    roomId: 'room-204',
    tournamentKey: 'tourn-1',
    scheduledMatchId: 'sched-4',
    sessionId: 'session-1',
    sessionToken: 'token-abc',
    tournamentName: 'Ninety Six Invitational',
    roomName: 'Room 204',
    roundNumber: 4,
    roundName: 'Round 4',
    matchup,
    scoringFormat: format,
    startedAt: '2026-08-08T14:00:00.000Z',
    ...overrides,
  };
}

describe('reopening the game this browser was scoring', () => {
  test('it comes back with the frozen context the game started with', () => {
    const storage = memoryStorage();
    expect(writeActiveGame(draft(), new Date(), storage)).toBe(true);

    const record = readActiveGame({ roomId: 'room-204' }, new Date(), storage);
    expect(record?.sessionId).toBe('session-1');
    expect(record?.sessionToken).toBe('token-abc');
    expect(record?.matchup.leftTeam.name).toBe('Ninety Six');
    expect(record?.scoringFormat.answerTypes.length).toBe(format.answerTypes.length);
  });

  test('a browser that refuses the write says so rather than promising recovery', () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => undefined,
    };
    expect(writeActiveGame(draft(), new Date(), storage)).toBe(false);
  });

  test('the tournament key is not required to reopen, because an offline browser cannot confirm one', () => {
    const storage = memoryStorage();
    writeActiveGame(draft(), new Date(), storage);

    // No `tournamentKey` in the expectation: this is the reload-during-an-outage case.
    expect(readActiveGame({ roomId: 'room-204' }, new Date(), storage)).not.toBeNull();
  });
});

describe('what it refuses', () => {
  test('a record belonging to another room', () => {
    const storage = memoryStorage();
    writeActiveGame(draft(), new Date(), storage);

    expect(readActiveGame({ roomId: 'room-118' }, new Date(), storage)).toBeNull();
  });

  test('a record from a tournament the server has since disagreed with', () => {
    const storage = memoryStorage();
    writeActiveGame(draft(), new Date(), storage);

    expect(readActiveGame({ roomId: 'room-204', tournamentKey: 'tourn-2' }, new Date(), storage)).toBeNull();
    expect(readActiveGame({ roomId: 'room-204', tournamentKey: 'tourn-1' }, new Date(), storage)).not.toBeNull();
  });

  test('a record older than a tournament day', () => {
    const storage = memoryStorage();
    const started = new Date('2026-08-08T14:00:00.000Z');
    writeActiveGame(draft(), started, storage);

    const tooLate = new Date(started.getTime() + activeRoomGameMaxAgeMs + 1000);
    expect(readActiveGame({ roomId: 'room-204' }, tooLate, storage)).toBeNull();
  });

  test('a version this build does not understand', () => {
    const storage = memoryStorage();
    writeActiveGame(draft(), new Date(), storage);
    const key = Array.from(storage.map.keys())[0];
    const stored = JSON.parse(storage.map.get(key) as string);
    storage.setItem(key, JSON.stringify({ ...stored, version: activeRoomGameVersion + 1 }));

    expect(readActiveGame({ roomId: 'room-204' }, new Date(), storage)).toBeNull();
  });

  test('a half-written record, rather than crashing the page that reads it', () => {
    const storage = memoryStorage();
    writeActiveGame(draft(), new Date(), storage);
    const key = Array.from(storage.map.keys())[0];
    const stored = JSON.parse(storage.map.get(key) as string);
    delete stored.matchup.leftTeam;
    storage.setItem(key, JSON.stringify(stored));

    expect(readActiveGame({ roomId: 'room-204' }, new Date(), storage)).toBeNull();
  });

  test('outright garbage', () => {
    const storage = memoryStorage();
    storage.setItem(`yellowfruit.room.active-game.v${activeRoomGameVersion}`, 'not json');

    expect(readActiveGame({ roomId: 'room-204' }, new Date(), storage)).toBeNull();
  });
});

describe('retiring it', () => {
  test('a clear for a game that is already over does not take the next one with it', () => {
    const storage = memoryStorage();
    writeActiveGame(draft({ sessionId: 'session-2' }), new Date(), storage);

    // A late clear from the finished game must not orphan the game now being scored.
    clearActiveGame('session-1', storage);
    expect(readActiveGame({ roomId: 'room-204' }, new Date(), storage)?.sessionId).toBe('session-2');

    clearActiveGame('session-2', storage);
    expect(readActiveGame({ roomId: 'room-204' }, new Date(), storage)).toBeNull();
  });

  test('touching it keeps a long game from ageing out underneath the scorekeeper', () => {
    const storage = memoryStorage();
    const started = new Date('2026-08-08T14:00:00.000Z');
    writeActiveGame(draft(), started, storage);

    const later = new Date(started.getTime() + activeRoomGameMaxAgeMs - 1000);
    expect(touchActiveGame('session-1', later, storage)).toBe(true);

    const laterStill = new Date(later.getTime() + 60_000);
    expect(readActiveGame({ roomId: 'room-204' }, laterStill, storage)).not.toBeNull();
  });

  test('touching another session leaves the record alone', () => {
    const storage = memoryStorage();
    writeActiveGame(draft(), new Date(), storage);

    expect(touchActiveGame('session-9', new Date(), storage)).toBe(false);
  });
});
