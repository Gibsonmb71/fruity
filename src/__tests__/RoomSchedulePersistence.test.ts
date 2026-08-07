/**
 * Rooms and scheduled matches have to survive the real save/load path, not just their own
 * `toYftFileObject`. These tests go through `Tournament.toFileObject`, a JSON round trip, and
 * `FileParser.parseYftTournament`, which is exactly what happens when a director saves a .yft file
 * and reopens it.
 */
import { describe, expect, test } from 'vitest';
import FileParser from '../renderer/DataModel/FileParsing';
import { IYftFileTournament } from '../renderer/DataModel/Tournament';
import { Match } from '../renderer/DataModel/Match';
import { ScheduledMatch, ScheduledMatchStatus } from '../renderer/DataModel/ScheduledMatch';
import SqbsGenerator from '../renderer/DataModel/SqbsFileGeneration';
import { TournamentRoom } from '../renderer/DataModel/TournamentRoom';
import TournamentServerService from '../renderer/Services/TournamentServerService';
import { makeTestTournament, testTeamNames } from './TestFixtures';

/** Save a tournament to a .yft-shaped object and read it back, as opening a saved file would */
function saveAndReopen(configure: (tourn: ReturnType<typeof makeTestTournament>) => void) {
  const original = makeTestTournament();
  original.appVersion = '4.0.18';
  configure(original);

  const written = JSON.parse(JSON.stringify(original.toFileObject())) as IYftFileTournament;

  return { original, written, reopened: reopen(written) };
}

/** Parse a written .yft object, failing the test rather than returning null */
function reopen(written: IYftFileTournament) {
  const reopened = new FileParser({}).parseYftTournament(written, '4.0.18');
  if (reopened === null) throw new Error('the tournament file failed to parse');
  return reopened;
}

describe('rooms in the .yft file', () => {
  test('new tournaments default to traditional entry and persist the choice only in YfData', () => {
    const tournament = makeTestTournament();
    const written = tournament.toFileObject() as IYftFileTournament;

    expect(tournament.roomScoringMode).toBe('traditional');
    expect(written.YfData.roomScoringMode).toBe('traditional');
    expect(JSON.stringify(tournament.toFileObject(true))).not.toContain('roomScoringMode');
  });

  test('legacy room configuration opts into browser scoring once during migration', () => {
    const { written } = saveAndReopen((tourn) => {
      tourn.rooms = [new TournamentRoom('Room 101', 0)];
    });
    delete written.YfData.roomScoringMode;

    const reopened = reopen(written);

    expect(reopened.roomScoringMode).toBe('browser');
    expect(reopened.rooms).toHaveLength(1);
  });

  test('legacy Live Display settings alone do not enable browser scoring', () => {
    const { written } = saveAndReopen((tourn) => {
      tourn.liveDisplaySettings.enabled = true;
    });
    delete written.YfData.roomScoringMode;
    delete written.YfData.rooms;
    delete written.YfData.scheduledMatches;

    const reopened = reopen(written);

    expect(reopened.roomScoringMode).toBe('traditional');
    expect(reopened.liveDisplaySettings.enabled).toBe(true);
  });

  test('an explicit traditional choice remains off while preserving room configuration', () => {
    const { reopened } = saveAndReopen((tourn) => {
      tourn.roomScoringMode = 'traditional';
      tourn.rooms = [new TournamentRoom('Room 101', 0)];
      const scheduled = new ScheduledMatch(1, testTeamNames[0], testTeamNames[1]);
      scheduled.roomId = tourn.rooms[0].id;
      tourn.scheduledMatches = [scheduled];
    });

    expect(reopened.roomScoringMode).toBe('traditional');
    expect(reopened.rooms).toHaveLength(1);
    expect(reopened.scheduledMatches[0].roomId).toBe(reopened.rooms[0].id);
  });

  test('rooms are written and read back with their ids and tokens', () => {
    const { original, reopened } = saveAndReopen((tourn) => {
      tourn.rooms = [
        new TournamentRoom('Room 101', 0),
        new TournamentRoom('Library', 1),
        new TournamentRoom('Cafeteria Left', 2),
      ];
    });

    expect(reopened.rooms).toHaveLength(3);
    expect(reopened.rooms.map((r) => r.name)).toEqual(['Room 101', 'Library', 'Cafeteria Left']);
    expect(reopened.rooms.map((r) => r.id)).toEqual(original.rooms.map((r) => r.id));
    expect(reopened.rooms.map((r) => r.accessToken)).toEqual(original.rooms.map((r) => r.accessToken));
  });

  test('a paired Chromebook’s URL still works after a save and reopen', () => {
    const { original, reopened } = saveAndReopen((tourn) => {
      tourn.rooms = [new TournamentRoom('Room 101', 0)];
    });

    expect(reopened.rooms[0].url('http://192.168.1.50:4732')).toBe(original.rooms[0].url('http://192.168.1.50:4732'));
  });

  test('a disabled room stays disabled', () => {
    const { reopened } = saveAndReopen((tourn) => {
      const room = new TournamentRoom('Broken Projector Room', 0);
      room.enabled = false;
      room.description = 'No power outlet';
      tourn.rooms = [room];
    });

    expect(reopened.rooms[0].enabled).toBe(false);
    expect(reopened.rooms[0].description).toBe('No power outlet');
  });

  test('rooms come back in sort order', () => {
    const { reopened } = saveAndReopen((tourn) => {
      tourn.rooms = [new TournamentRoom('Third', 2), new TournamentRoom('First', 0), new TournamentRoom('Second', 1)];
    });

    expect(reopened.rooms.map((r) => r.name)).toEqual(['First', 'Second', 'Third']);
  });

  test('a tournament with no rooms writes no rooms key at all', () => {
    // A tournament that never touched the server should write the same file it always did.
    const { written } = saveAndReopen(() => {});

    expect(written.YfData.rooms).toBeUndefined();
    expect(written.YfData.scheduledMatches).toBeUndefined();
  });

  test('opening a file that predates rooms yields an empty list rather than undefined', () => {
    const { written } = saveAndReopen(() => {});
    delete written.YfData.rooms;

    const reopened = reopen(written);

    expect(reopened.rooms).toEqual([]);
    expect(reopened.scheduledMatches).toEqual([]);
  });

  test('a corrupt room entry is skipped without failing the whole file', () => {
    const { written } = saveAndReopen((tourn) => {
      tourn.rooms = [new TournamentRoom('Good Room', 0)];
    });
    written.YfData.rooms = [{ name: 42 } as any, ...(written.YfData.rooms ?? [])];

    const reopened = reopen(written);

    expect(reopened.rooms.map((r) => r.name)).toEqual(['Good Room']);
  });

  test('a skipped optional room entry produces a repair diagnostic', () => {
    const { written } = saveAndReopen((tourn) => {
      tourn.rooms = [new TournamentRoom('Good Room', 0)];
    });
    written.YfData.rooms = [{ name: 42 } as any, ...(written.YfData.rooms ?? [])];

    const parser = new FileParser({});
    parser.parseYftTournament(written, '4.0.18');

    expect(parser.repaired).toBe(true);
    expect(parser.requiresReview).toBe(true);
    expect(parser.diagnostics).toContain('Room entry 1 was ignored because it was malformed.');
  });
});

describe('scheduled matches in the .yft file', () => {
  test('a scheduled match round-trips with its room, status, and result link', () => {
    const { original, reopened } = saveAndReopen((tourn) => {
      const room = new TournamentRoom('Room 101', 0);
      tourn.rooms = [room];

      const scheduled = new ScheduledMatch(1, testTeamNames[0], testTeamNames[1]);
      scheduled.phaseCode = '1';
      scheduled.poolName = 'Prelim Pool 1';
      scheduled.roomId = room.id;
      scheduled.status = ScheduledMatchStatus.Accepted;
      scheduled.resultMatchId = 'Match_3';
      scheduled.generated = true;
      tourn.scheduledMatches = [scheduled];
    });

    expect(reopened.scheduledMatches).toHaveLength(1);
    expect(reopened.scheduledMatches[0]).toEqual(original.scheduledMatches[0]);
    expect(reopened.scheduledMatches[0].roomId).toBe(reopened.rooms[0].id);
  });

  test('the accepted result link survives, so a duplicate accept stays detectable', () => {
    const { reopened } = saveAndReopen((tourn) => {
      const scheduled = new ScheduledMatch(2, testTeamNames[0], testTeamNames[1]);
      scheduled.status = ScheduledMatchStatus.Accepted;
      scheduled.resultMatchId = 'Match_9';
      tourn.scheduledMatches = [scheduled];
    });

    expect(reopened.scheduledMatches[0].isAccepted()).toBe(true);
    expect(reopened.scheduledMatches[0].resultMatchId).toBe('Match_9');
    expect(reopened.scheduledMatches[0].isPlayable()).toBe(false);
  });

  test('a submitted final awaiting review survives a restart', () => {
    const { reopened } = saveAndReopen((tourn) => {
      const scheduled = new ScheduledMatch(3, testTeamNames[2], testTeamNames[3]);
      scheduled.status = ScheduledMatchStatus.Submitted;
      tourn.scheduledMatches = [scheduled];
    });

    expect(reopened.scheduledMatches[0].status).toBe(ScheduledMatchStatus.Submitted);
  });

  test('a full round of scheduled matches round-trips', () => {
    const { reopened } = saveAndReopen((tourn) => {
      tourn.rooms = [new TournamentRoom('101', 0), new TournamentRoom('102', 1)];
      tourn.scheduledMatches = [
        (() => {
          const m = new ScheduledMatch(1, testTeamNames[0], testTeamNames[1]);
          m.roomId = tourn.rooms[0].id;
          return m;
        })(),
        (() => {
          const m = new ScheduledMatch(1, testTeamNames[2], testTeamNames[3]);
          m.roomId = tourn.rooms[1].id;
          return m;
        })(),
      ];
    });

    expect(reopened.scheduledMatches).toHaveLength(2);
    expect(new Set(reopened.scheduledMatches.map((m) => m.roomId)).size).toBe(2);
  });

  test('a corrupt scheduled match is skipped without failing the whole file', () => {
    const { written } = saveAndReopen((tourn) => {
      tourn.scheduledMatches = [new ScheduledMatch(1, testTeamNames[0], testTeamNames[1])];
    });
    written.YfData.scheduledMatches = [
      { roundNumber: 'not a round' } as any,
      ...(written.YfData.scheduledMatches ?? []),
    ];

    const reopened = reopen(written);

    expect(reopened.scheduledMatches).toHaveLength(1);
  });

  test('legacy scheduled entries without lifecycle metadata default to Scheduled and are reported', () => {
    const { written } = saveAndReopen((tourn) => {
      tourn.scheduledMatches = [new ScheduledMatch(1, testTeamNames[0], testTeamNames[1])];
    });
    const legacyScheduled = written.YfData.scheduledMatches?.[0] as { status?: ScheduledMatchStatus } | undefined;
    if (legacyScheduled) legacyScheduled.status = undefined;

    const parser = new FileParser({});
    const reopened = parser.parseYftTournament(written, '4.0.18');

    expect(reopened?.scheduledMatches[0].status).toBe(ScheduledMatchStatus.Scheduled);
    expect(parser.repaired).toBe(true);
    expect(parser.requiresReview).toBe(false);
    expect(parser.diagnostics[0]).toContain('legacy scheduled match entry');
  });

  test('a missing status on a linked historical result is quarantined', () => {
    const { written } = saveAndReopen((tourn) => {
      const scheduled = new ScheduledMatch(1, testTeamNames[0], testTeamNames[1]);
      scheduled.resultMatchId = 'Match_1';
      tourn.scheduledMatches = [scheduled];
    });
    const legacyScheduled = written.YfData.scheduledMatches?.[0] as { status?: ScheduledMatchStatus } | undefined;
    if (legacyScheduled) legacyScheduled.status = undefined;

    const reopened = reopen(written);

    expect(reopened.scheduledMatches[0].status).toBe(ScheduledMatchStatus.NeedsAttention);
    expect(reopened.scheduledMatches[0].isPlayable()).toBe(false);
  });
});

describe('room allocation policies in the .yft file', () => {
  test('stage, round, pool, availability, and assignment metadata round-trip', () => {
    const { original, written, reopened } = saveAndReopen((tourn) => {
      const phase = tourn.getPrelimPhase();
      if (!phase) throw new Error('test tournament has no prelim phase');
      const room = new TournamentRoom('Room 101', 0);
      room.availableRoundNumbers = [1, 2, 2.5];
      tourn.rooms = [room];
      phase.roomIds = [room.id];
      phase.rounds[0].roomIds = [room.id];
      phase.pools[0].preferredRoomIds = [room.id];
      phase.pools[0].poolRoomsLocked = true;

      const scheduled = new ScheduledMatch(1, testTeamNames[0], testTeamNames[1]);
      scheduled.phaseCode = phase.code;
      scheduled.roomId = room.id;
      scheduled.roomAssignmentLocked = true;
      scheduled.roomAssignmentSource = 'manual';
      scheduled.roomNameAtPlay = room.name;
      tourn.scheduledMatches = [scheduled];
    });

    expect(written.YfData.rooms?.[0].availableRoundNumbers).toEqual([1, 2, 2.5]);
    expect(reopened.rooms[0].availableRoundNumbers).toEqual([1, 2, 2.5]);
    const reopenedPhase = reopened.getPrelimPhase();
    expect(reopenedPhase?.roomIds).toEqual([original.rooms[0].id]);
    expect(reopenedPhase?.rounds[0].roomIds).toEqual([original.rooms[0].id]);
    expect(reopenedPhase?.pools[0].preferredRoomIds).toEqual([original.rooms[0].id]);
    expect(reopenedPhase?.pools[0].poolRoomsLocked).toBe(true);
    expect(reopened.scheduledMatches[0].roomAssignmentLocked).toBe(true);
    expect(reopened.scheduledMatches[0].roomAssignmentSource).toBe('manual');
    expect(reopened.scheduledMatches[0].roomNameAtPlay).toBe('Room 101');
  });

  test('legacy files load with old room assignments and no policy defaults', () => {
    const { written } = saveAndReopen((tourn) => {
      const phase = tourn.getPrelimPhase();
      if (!phase) throw new Error('test tournament has no prelim phase');
      const room = new TournamentRoom('Room 101', 0);
      tourn.rooms = [room];
      phase.roomIds = [room.id];
      phase.rounds[0].roomIds = [room.id];
      phase.pools[0].preferredRoomIds = [room.id];
      const scheduled = new ScheduledMatch(1, testTeamNames[0], testTeamNames[1]);
      scheduled.roomId = room.id;
      scheduled.roomAssignmentLocked = true;
      tourn.scheduledMatches = [scheduled];
    });

    delete written.YfData.rooms?.[0].availableRoundNumbers;
    const phase = (written.phases?.[0] as any).YfData;
    delete phase.roomIds;
    delete (written.phases?.[0]?.rounds?.[0] as any).YfData.roomIds;
    delete (written.phases?.[0]?.pools?.[0] as any).YfData.preferredRoomIds;
    delete (written.phases?.[0]?.pools?.[0] as any).YfData.poolRoomsLocked;
    delete written.YfData.scheduledMatches?.[0].roomAssignmentLocked;
    delete written.YfData.scheduledMatches?.[0].roomAssignmentSource;
    delete written.YfData.scheduledMatches?.[0].roomNameAtPlay;

    const reopened = reopen(written);
    expect(reopened.rooms[0].availableRoundNumbers).toBeUndefined();
    expect(reopened.getPrelimPhase()?.roomIds).toBeUndefined();
    expect(reopened.getPrelimPhase()?.rounds[0].roomIds).toBeUndefined();
    expect(reopened.getPrelimPhase()?.pools[0].preferredRoomIds).toBeUndefined();
    expect(reopened.scheduledMatches[0].roomId).toBe(reopened.rooms[0].id);
    expect(reopened.scheduledMatches[0].roomAssignmentLocked).toBeUndefined();
  });
});

describe('round release metadata in the .yft file', () => {
  test('released round, automatic release, and rebracket checkpoints round-trip', () => {
    const { original, reopened, written } = saveAndReopen((tourn) => {
      tourn.releasedRoundNumber = 4;
      tourn.autoReleaseNextRound = true;
      tourn.rebracketedPhaseCodes = ['prelim'];
    });

    expect(written.YfData.releasedRoundNumber).toBe(4);
    expect(reopened.releasedRoundNumber).toBe(original.releasedRoundNumber);
    expect(reopened.autoReleaseNextRound).toBe(true);
    expect(reopened.rebracketedPhaseCodes).toEqual(['prelim']);
  });

  test('legacy files without release metadata remain closed until a round is released', () => {
    const { written } = saveAndReopen(() => {});
    delete written.YfData.releasedRoundNumber;
    delete written.YfData.autoReleaseNextRound;
    delete written.YfData.rebracketedPhaseCodes;

    const reopened = reopen(written);

    expect(reopened.releasedRoundNumber).toBeNull();
    expect(reopened.autoReleaseNextRound).toBe(false);
    expect(reopened.rebracketedPhaseCodes).toEqual([]);
  });
});

describe('live display settings in the .yft file', () => {
  test('settings persist while browser slideshow position does not exist in the file', () => {
    const { original, reopened, written } = saveAndReopen((tourn) => {
      tourn.liveDisplaySettings.enabled = true;
      tourn.liveDisplaySettings.slides.pools = false;
      tourn.liveDisplaySettings.slideDurationSeconds = 30;
      tourn.liveDisplaySettings.rowsPerSlide = 18;
      tourn.liveDisplaySettings.theme = 'dark';
      tourn.liveDisplaySettings.showLastUpdated = false;
    });

    expect(written.YfData.liveDisplay).toMatchObject({
      enabled: true,
      slideDurationSeconds: 30,
      rowsPerSlide: 18,
      theme: 'dark',
      showLastUpdated: false,
    });
    expect(reopened.liveDisplaySettings).toEqual(original.liveDisplaySettings);
    expect(JSON.stringify(written.YfData.liveDisplay)).not.toContain('currentSlide');
  });
});

describe('QBJ export stays clean', () => {
  test('rooms and scheduled matches are not written to QBJ', () => {
    const tourn = makeTestTournament();
    const room = new TournamentRoom('Room 101', 0);
    room.availableRoundNumbers = [1];
    tourn.rooms = [room];
    const phase = tourn.getPrelimPhase();
    if (!phase) throw new Error('test tournament has no prelim phase');
    phase.roomIds = [room.id];
    phase.rounds[0].roomIds = [room.id];
    phase.pools[0].preferredRoomIds = [room.id];
    const scheduled = new ScheduledMatch(1, testTeamNames[0], testTeamNames[1]);
    scheduled.roomId = room.id;
    scheduled.roomAssignmentLocked = true;
    scheduled.roomAssignmentSource = 'manual';
    scheduled.roomNameAtPlay = room.name;
    tourn.scheduledMatches = [scheduled];

    // qbjOnly is what the QBJ export path passes; YellowFruit-specific metadata must not leak into a
    // file other programs will read.
    const qbj = JSON.stringify(tourn.toFileObject(true));

    expect(qbj).not.toContain('accessToken');
    expect(qbj).not.toContain('scheduledMatches');
    expect(qbj).not.toContain('YfData');
    expect(qbj).not.toContain('availableRoundNumbers');
    expect(qbj).not.toContain('roomAssignmentLocked');
    expect(qbj).not.toContain('preferredRoomIds');
  });
});

describe('SQBS export stays clean', () => {
  test('room and server-only metadata never crosses the SQBS boundary', () => {
    const tournament = makeTestTournament();
    tournament.roomScoringMode = 'browser';
    tournament.releasedRoundNumber = 1;
    const room = new TournamentRoom('Room 101', 0, 'room-boundary-id', 'room-secret-token', '12345678');
    tournament.rooms = [room];
    const phase = tournament.getPrelimPhase();
    const left = tournament.findTeamByName(testTeamNames[0]);
    const right = tournament.findTeamByName(testTeamNames[1]);
    if (!phase || !left || !right) throw new Error('test tournament is missing its prelim phase or teams');
    phase.rounds[0].addMatch(new Match(left, right, tournament.scoringRules.answerTypes));
    const scheduled = new ScheduledMatch(1, left.name, right.name, 'scheduled-boundary-id');
    scheduled.roomId = room.id;
    scheduled.roomAssignmentLocked = true;
    tournament.scheduledMatches = [scheduled];

    const generator = new SqbsGenerator(tournament);
    generator.generateFile([phase]);

    expect(generator.errorMessage).toBe('');
    expect(generator.fileOutput).not.toContain('room-secret-token');
    expect(generator.fileOutput).not.toContain('scheduled-boundary-id');
    expect(generator.fileOutput).not.toContain('room-boundary-id');
    expect(generator.fileOutput).not.toContain('12345678');
  });
});

describe('room policy edits do not reset server recovery', () => {
  test('recovery identity is unchanged by policy and assignment metadata', () => {
    const tourn = makeTestTournament();
    const room = new TournamentRoom('Room 101', 0);
    tourn.rooms = [room];
    const phase = tourn.getPrelimPhase();
    if (!phase) throw new Error('test tournament has no prelim phase');
    const scheduled = new ScheduledMatch(1, testTeamNames[0], testTeamNames[1]);
    scheduled.roomId = room.id;
    tourn.scheduledMatches = [scheduled];

    const service = new TournamentServerService(tourn);
    const before = (service as any).recoveryKey();

    phase.roomIds = [room.id];
    phase.rounds[0].roomIds = [room.id];
    phase.pools[0].preferredRoomIds = [room.id];
    phase.pools[0].poolRoomsLocked = true;
    room.availableRoundNumbers = [1];
    scheduled.roomAssignmentLocked = true;
    scheduled.roomAssignmentSource = 'manual';
    scheduled.roomNameAtPlay = room.name;

    expect((service as any).recoveryKey()).toBe(before);
  });
});
