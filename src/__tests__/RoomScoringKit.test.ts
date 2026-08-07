/**
 * What a Chromebook is allowed to remember, and when it is allowed to act on it.
 *
 * The kit is the only thing standing between "the server died" and "the round cannot be played".
 * It is also the only thing that could quietly let a Chromebook score a game against last weekend's
 * rosters, or carry a room's private configuration around on a device in a classroom. Both of those
 * are cheap to prevent here and expensive to notice later.
 */
import { describe, expect, test } from 'vitest';
import {
  buildScoringKit,
  describeUnusableKit,
  isScoringKitUsable,
  readScoringKit,
  scoringKitMaxAgeMs,
  scoringKitVersion,
  writeScoringKit,
} from '../room/ScoringKit';
import { IModaqGameFormat } from '../renderer/Services/YellowFruitScoringRulesToModaq';

const gameFormat = { regulationTossupCount: 20, minimumOvertimeQuestionCount: 1 } as unknown as IModaqGameFormat;

function memoryStorage(initial: Record<string, string> = {}) {
  const store = { ...initial };
  return {
    store,
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
  };
}

function source(overrides: Partial<Parameters<typeof buildScoringKit>[0]> = {}) {
  return {
    tournamentKey: 'Ninety Six Invitational',
    tournamentName: 'Ninety Six Invitational',
    gameFormat,
    timedRounds: false,
    teams: [
      { name: 'Ninety Six A', players: [{ name: 'Ada' }, { name: 'Ben' }] },
      { name: 'Greenwood', players: [{ name: 'Cal' }] },
    ],
    rounds: [
      { number: 4, name: '4' },
      { number: 5, name: '5' },
    ],
    roomId: 'room-204',
    roomName: 'Room 204',
    ...overrides,
  };
}

describe('what the kit keeps', () => {
  test('it keeps the seven things an emergency game needs', () => {
    const kit = buildScoringKit(source());

    expect(kit.tournamentName).toBe('Ninety Six Invitational');
    expect(kit.gameFormat).toBe(gameFormat);
    expect(kit.teams.map((team) => team.name)).toEqual(['Ninety Six A', 'Greenwood']);
    expect(kit.teams[0].players.map((player) => player.name)).toEqual(['Ada', 'Ben']);
    expect(kit.rounds.map((round) => round.number)).toEqual([4, 5]);
    expect(kit.roomName).toBe('Room 204');
    expect(kit.updatedAt).not.toBe('');
  });

  test('anything else attached to a team does not travel with it', () => {
    const kit = buildScoringKit(
      source({
        teams: [
          { name: 'Ninety Six A', players: [{ name: 'Ada' }], accessToken: 'room-token' },
          { name: 'Greenwood', players: [] },
        ] as never,
      }),
    );

    expect(Object.keys(kit.teams[0])).toEqual(['name', 'players']);
    expect(JSON.stringify(kit)).not.toContain('room-token');
  });

  test('a written kit reads back with only the fields it declares', () => {
    const storage = memoryStorage();
    writeScoringKit(buildScoringKit(source()), storage);

    const kit = readScoringKit(storage);

    expect(kit).not.toBeNull();
    expect(Object.keys(kit as object).sort()).toEqual(
      [
        'gameFormat',
        'roomId',
        'roomName',
        'rounds',
        'teams',
        'timedRounds',
        'tournamentKey',
        'tournamentName',
        'updatedAt',
        'version',
      ].sort(),
    );
  });
});

describe('when the kit may be used', () => {
  test('a complete, fresh kit is usable', () => {
    expect(isScoringKitUsable(buildScoringKit(source()))).toBe(true);
  });

  test('no kit at all means emergency scoring is refused', () => {
    expect(isScoringKitUsable(null)).toBe(false);
    expect(describeUnusableKit(null)).toContain('has not loaded tournament information');
  });

  test('a kit without usable scoring rules is refused', () => {
    const kit = buildScoringKit(source({ gameFormat: null }));

    expect(isScoringKitUsable(kit)).toBe(false);
    expect(describeUnusableKit(kit)).toContain('scoring rules');
  });

  test('a kit from a previous tournament is too old to trust', () => {
    const now = new Date('2026-08-07T09:00:00.000Z');
    const stale = buildScoringKit(source(), new Date(now.getTime() - scoringKitMaxAgeMs - 1));

    expect(isScoringKitUsable(stale, now)).toBe(false);
    expect(describeUnusableKit(stale, now)).toContain('too old');
  });

  test('a future-dated kit is refused', () => {
    const now = new Date('2026-08-07T09:00:00.000Z');
    const future = buildScoringKit(source(), new Date(now.getTime() + 60_000));

    expect(isScoringKitUsable(future, now)).toBe(false);
    expect(describeUnusableKit(future, now)).toContain('too old');
  });

  test('a kit written by another version is not guessed at', () => {
    const kit = { ...buildScoringKit(source()), version: scoringKitVersion + 1 };

    expect(isScoringKitUsable(kit)).toBe(false);
  });

  test('a corrupt stored kit reads as no kit rather than throwing', () => {
    const storage = memoryStorage({ 'yellowfruit.room.scoring-kit.v1': '{not json' });

    expect(readScoringKit(storage)).toBeNull();
  });

  test('a kit with only one team cannot produce a game', () => {
    const kit = buildScoringKit(source({ teams: [{ name: 'Ninety Six A', players: [] }] }));

    expect(isScoringKitUsable(kit)).toBe(false);
  });
});
