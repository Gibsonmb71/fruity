/**
 * The cross-repo contract, on the QBJ path.
 *
 *   Fruity ScheduledMatch
 *       -> assignment.qbj
 *       -> QBSheet's QBJ parser
 *       -> GameDefinition
 *       -> score events
 *       -> result.qbj
 *       -> Fruity's importer
 *       -> scheduled-result reconciliation
 *       -> final Match
 *
 * Every step is the real code on both sides — the export Fruity writes, the parser QBSheet ships,
 * the importer the director uses. Nothing here reimplements a format, because a contract test that
 * reimplements one of its ends is testing itself.
 *
 * The claim being proved is narrow and load-bearing: identity survives the whole round trip, so
 * reconciliation is a lookup rather than a guess about which game a file belongs to.
 */
import { describe, expect, test } from 'vitest';
import {
  applyScoreEvents,
  buildResultDocument,
  deriveGame,
  openGameText,
  portableQbjDocument,
  qbjSerializationVersion,
  qbtcpExtensionKey,
  type IGameSetup,
} from 'qbsheet';
import { ScheduledMatch, ScheduledMatchStatus } from '../renderer/DataModel/ScheduledMatch';
import { TournamentRoom } from '../renderer/DataModel/TournamentRoom';
import MatchImportService from '../renderer/Services/MatchImportService';
import { buildQbjAssignment, exportQbjAssignments, qbjAssignmentFileName } from '../renderer/Services/QbjAssignment';
import { readQbsheetSourceMetadata } from '../renderer/Services/QbsheetQbjMetadata';
import {
  commitScheduledResult,
  suggestScheduledMatchForImport,
} from '../renderer/Services/ScheduledResultReconciliation';
import { makeTestTournament, testTeamNames } from './TestFixtures';
import { event } from './RoomScoreEventFixtures';
import Tournament from '../renderer/DataModel/Tournament';

/** A tournament with one released round and one room-assigned game in it. */
function contractTournament(): { tournament: Tournament; scheduled: ScheduledMatch } {
  const tournament = makeTestTournament();
  tournament.name = 'QBJ Contract Test';
  tournament.operationalId = 'contract-tournament';
  tournament.roomScoringMode = 'browser';
  tournament.releasedRoundNumber = 1;
  tournament.resultHandoffInstruction = 'Upload the QBJ to the room folder.';

  const room = new TournamentRoom('Room 204', 0, 'room-204', 'test-room-token', '12345678');
  tournament.rooms = [room];

  const scheduled = new ScheduledMatch(1, testTeamNames[0], testTeamNames[1], 'scheduled-contract-1');
  scheduled.phaseCode = tournament.getPrelimPhase()?.code ?? '1';
  scheduled.roomId = room.id;
  scheduled.status = ScheduledMatchStatus.Ready;
  tournament.scheduledMatches = [scheduled];

  return { tournament, scheduled };
}

/** Export one assignment and hand it over exactly as a file would arrive: as text. */
function assignmentText(tournament: Tournament): string {
  const exported = exportQbjAssignments(tournament, 1);
  if (!exported.ok) throw new Error(exported.error);
  expect(exported.assignments).toHaveLength(1);
  return JSON.stringify(exported.assignments[0].document);
}

/** Open an assignment through QBSheet's parser, which is the only reader on that side. */
function openAssignment(text: string) {
  const opened = openGameText(text);
  if (!opened.ok || opened.kind !== 'game') {
    throw new Error(`QBSheet could not open the assignment: ${JSON.stringify(opened)}`);
  }
  return opened.definition;
}

describe('Fruity writes an assignment QBJ', () => {
  test('one file per scheduled game, named descriptively', () => {
    const { tournament } = contractTournament();

    const exported = exportQbjAssignments(tournament, 1);

    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(exported.assignments).toHaveLength(1);
    expect(qbjAssignmentFileName(exported.assignments[0])).toMatch(/^R01_Room-204_.*\.assignment\.qbj$/);
  });

  test('it is an official serialized document at the supported version', () => {
    const { tournament } = contractTournament();

    const document = JSON.parse(assignmentText(tournament));

    expect(document.version).toBe(qbjSerializationVersion);
    expect(Array.isArray(document.objects)).toBe(true);
    for (const type of ['Tournament', 'ScoringRules', 'Registration', 'Team', 'Match']) {
      expect(document.objects.some((entry: { type?: string }) => entry.type === type)).toBe(true);
    }
  });

  test('the match is unplayed, with no invented zeroes', () => {
    const { tournament } = contractTournament();

    const document = JSON.parse(assignmentText(tournament));
    const match = document.objects.find((entry: { type?: string }) => entry.type === 'Match');

    // The absence of scoring content is what tells an importer this is an assignment.
    expect(match.tossups_read).toBeUndefined();
    expect(match.match_questions).toBeUndefined();
    for (const matchTeam of match.match_teams) {
      expect(matchTeam.points).toBeUndefined();
      expect(matchTeam.match_players).toBeUndefined();
    }
  });

  test('only the requested round is in the file', () => {
    const { tournament } = contractTournament();
    const other = new ScheduledMatch(2, testTeamNames[2], testTeamNames[3], 'scheduled-contract-2');
    other.phaseCode = tournament.getPrelimPhase()?.code ?? '1';
    other.roomId = 'room-204';
    other.status = ScheduledMatchStatus.Ready;
    tournament.scheduledMatches.push(other);

    const serialized = assignmentText(tournament);

    // Round 2's game, its teams, and the round itself are all absent: a room gets its own game.
    expect(serialized).not.toContain('scheduled-contract-2');
    expect(serialized).not.toContain(testTeamNames[2]);
    expect(JSON.parse(serialized).objects.filter((e: { type?: string }) => e.type === 'Match')).toHaveLength(1);
  });

  test('an unreleased round is refused', () => {
    const { tournament } = contractTournament();

    expect(exportQbjAssignments(tournament, 2)).toEqual({
      ok: false,
      error: 'That round has not been released to room scorekeepers.',
    });
  });

  test('no credential of any kind reaches the file', () => {
    const { tournament } = contractTournament();

    const serialized = assignmentText(tournament).toLowerCase();

    // The room's own token and pairing code are on the TournamentRoom this was built from.
    expect(serialized).not.toContain('test-room-token');
    expect(serialized).not.toContain('12345678');
    for (const forbidden of ['token', 'pairing', 'authorization', 'secret', 'password']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  test('the operational extension carries the round revision and the stable room id', () => {
    const { tournament } = contractTournament();

    const document = JSON.parse(assignmentText(tournament));
    const match = document.objects.find((entry: { type?: string }) => entry.type === 'Match');
    const extension = match[qbtcpExtensionKey];

    expect(extension.round_revision).toEqual(expect.any(Number));
    expect(extension.room_id).toBe('room-204');
    expect(extension.handoff_instruction).toBe('Upload the QBJ to the room folder.');
    // Nothing standard QBJ already carries is restated here.
    for (const forbidden of ['tournament_id', 'match_id', 'round_name', 'teams', 'location']) {
      expect(extension[forbidden]).toBeUndefined();
    }
  });

  test('a rebracket changes the revision, so a result scored against the old draw is detectable', () => {
    const { tournament, scheduled } = contractTournament();
    const before = JSON.parse(assignmentText(tournament)).objects.find(
      (entry: { type?: string }) => entry.type === 'Match',
    )[qbtcpExtensionKey].round_revision;

    [, , scheduled.rightTeamName] = testTeamNames;
    const after = JSON.parse(assignmentText(tournament)).objects.find(
      (entry: { type?: string }) => entry.type === 'Match',
    )[qbtcpExtensionKey].round_revision;

    expect(after).not.toBe(before);
  });
});

describe('QBSheet reads what Fruity wrote', () => {
  test('the assignment becomes a game definition with every identity preserved', () => {
    const { tournament, scheduled } = contractTournament();

    const definition = openAssignment(assignmentText(tournament));

    expect(definition.origin).toBe('qbj');
    expect(definition.tournament.name).toBe('QBJ Contract Test');
    expect(definition.qbjIdentity?.tournamentId).toBe('contract-tournament');
    expect(definition.qbjIdentity?.matchId).toBe(scheduled.id);
    expect(definition.left.name).toBe(testTeamNames[0]);
    expect(definition.right.name).toBe(testTeamNames[1]);
    expect(definition.round.number).toBe(1);
    expect(definition.room?.name).toBe('Room 204');
    expect(definition.room?.id).toBe('room-204');
  });

  test('the rosters and the scoring rules survive the trip', () => {
    const { tournament } = contractTournament();

    const definition = openAssignment(assignmentText(tournament));

    expect(definition.left.players.length).toBeGreaterThan(0);
    expect(definition.scorekeeperFormat.answerTypes.some((type) => type.value > 0)).toBe(true);
    // Read structurally; nothing anywhere branches on what the rule set is called.
    expect(definition.scorekeeperFormat.regulation.tossupCount).toBeGreaterThan(0);
  });

  test('no scorekeeper question is raised for a complete Fruity assignment', () => {
    const { tournament } = contractTournament();

    const definition = openAssignment(assignmentText(tournament));

    // Rules, rosters and procedure were all supplied, so nothing had to be assumed about scoring.
    const assumptions = (definition.assumptions ?? []).join(' ');
    expect(assumptions).not.toContain('scoring');
    expect(assumptions).not.toContain('timed');
  });
});

describe('the round trip back into Fruity', () => {
  /** Score a short representative game against a definition and return the result document text. */
  function scoreAndExport(definition: ReturnType<typeof openAssignment>): string {
    const format = definition.scorekeeperFormat;
    const setup: IGameSetup = {
      left: { name: definition.left.name, players: definition.left.players.map((player) => player.name) },
      right: { name: definition.right.name, players: definition.right.players.map((player) => player.name) },
    };
    const answerTypeIndex = (value: number) => {
      const answerType = format.answerTypes.find((candidate) => candidate.value === value);
      if (!answerType) throw new Error(`No answer type worth ${value}`);
      return answerType.index;
    };

    const accepted = applyScoreEvents(
      { format, setup, procedure: definition.procedure },
      [],
      [
        event({
          type: 'tossup-buzz',
          questionNumber: 1,
          team: 'left',
          playerName: setup.left.players[0],
          answerTypeIndex: answerTypeIndex(15),
        }),
        event({ type: 'bonus', questionNumber: 1, team: 'left', controlledPoints: 20 }),
        event({
          type: 'tossup-buzz',
          questionNumber: 2,
          team: 'right',
          playerName: setup.right.players[0],
          answerTypeIndex: answerTypeIndex(10),
        }),
        event({ type: 'bonus', questionNumber: 2, team: 'right', controlledPoints: 30 }),
        event({ type: 'tossup-dead', questionNumber: 3 }),
      ],
    );
    if (!accepted.ok) throw new Error('The representative events should be scoreable');

    const game = deriveGame(format, setup, accepted.events);
    const document = buildResultDocument({ definition, format, game });
    // The same sanitization boundary every download goes through.
    return JSON.stringify(portableQbjDocument(document));
  }

  test('the result is the assignment filled in, and lands on the right scheduled game', () => {
    const { tournament, scheduled } = contractTournament();
    const resultText = scoreAndExport(openAssignment(assignmentText(tournament)));

    const imported = new MatchImportService(tournament).importMatches([
      { filePath: 'R01_Room-204.result.qbj', fileContents: resultText },
    ]);

    expect(imported.hadInvalidJson).toBe(false);
    expect(imported.results).toHaveLength(1);
    const [result] = imported.results;
    expect(result.match).toBeDefined();
    if (!result.match) return;

    // Match.id carried the identity the whole way; nothing had to be guessed from names.
    expect(suggestScheduledMatchForImport(tournament, result)).toEqual({
      kind: 'candidate',
      suggestion: expect.objectContaining({ scheduledMatchId: scheduled.id }),
    });

    expect(commitScheduledResult(tournament, result, scheduled.id)).toEqual({ ok: true, matchId: result.match.id });

    const finalMatch = tournament.getRoundObjByNumber(1)?.matches[0];
    expect(finalMatch).toBe(result.match);
    expect(scheduled.status).toBe(ScheduledMatchStatus.Accepted);
    expect(scheduled.resultMatchId).toBe(finalMatch?.id);
    expect(finalMatch?.leftTeam.points).toBe(35);
    expect(finalMatch?.rightTeam.points).toBe(40);
    expect(finalMatch?.leftTeam.getBonusPoints()).toBe(20);
    expect(finalMatch?.rightTeam.getBonusPoints()).toBe(30);
    expect(finalMatch?.tossupsRead).toBe(3);
  });

  test('the identity Fruity reads back is the identity it wrote', () => {
    const { tournament, scheduled } = contractTournament();
    const resultText = scoreAndExport(openAssignment(assignmentText(tournament)));

    const metadata = readQbsheetSourceMetadata(JSON.parse(resultText));

    expect(metadata).toMatchObject({
      producer: 'QBSheet',
      tournamentId: 'contract-tournament',
      scheduledMatchId: scheduled.id,
      roundNumber: 1,
    });
    expect(metadata?.roundRevision).toEqual(expect.any(Number));
  });

  test('only one Match is created, and the round holds only it', () => {
    const { tournament, scheduled } = contractTournament();
    const resultText = scoreAndExport(openAssignment(assignmentText(tournament)));

    const imported = new MatchImportService(tournament).importMatches([
      { filePath: 'result.qbj', fileContents: resultText },
    ]);
    commitScheduledResult(tournament, imported.results[0], scheduled.id);

    expect(tournament.getRoundObjByNumber(1)?.matches).toHaveLength(1);
  });

  test('the same result arriving twice is recognized as a backup, not a second game', () => {
    const { tournament, scheduled } = contractTournament();
    const resultText = scoreAndExport(openAssignment(assignmentText(tournament)));
    const service = new MatchImportService(tournament);

    const first = service.importMatches([{ filePath: 'auto.qbj', fileContents: resultText }]);
    commitScheduledResult(tournament, first.results[0], scheduled.id);

    // The scorekeeper's manually kept copy of the identical game.
    const second = new MatchImportService(tournament).importMatches([
      { filePath: 'manual-backup.qbj', fileContents: resultText },
    ]);

    expect(suggestScheduledMatchForImport(tournament, second.results[0])).toEqual({
      kind: 'backup',
      scheduledMatchId: scheduled.id,
    });
    expect(tournament.getRoundObjByNumber(1)?.matches).toHaveLength(1);
  });

  test('a backup whose statistics differ goes to explicit review rather than overwriting', () => {
    const { tournament, scheduled } = contractTournament();
    const definition = openAssignment(assignmentText(tournament));
    const resultText = scoreAndExport(definition);

    const first = new MatchImportService(tournament).importMatches([
      { filePath: 'auto.qbj', fileContents: resultText },
    ]);
    commitScheduledResult(tournament, first.results[0], scheduled.id);

    // Same game, same identity, different score.
    const altered = JSON.parse(resultText);
    const match = altered.objects.find((entry: { type?: string }) => entry.type === 'Match');
    match.match_teams[0].points += 5;

    const second = new MatchImportService(tournament).importMatches([
      { filePath: 'conflicting.qbj', fileContents: JSON.stringify(altered) },
    ]);

    expect(suggestScheduledMatchForImport(tournament, second.results[0])).toEqual({
      kind: 'conflict',
      scheduledMatchId: scheduled.id,
    });
  });

  test('a result scored against a superseded draw is flagged as stale', () => {
    const { tournament, scheduled } = contractTournament();
    const resultText = scoreAndExport(openAssignment(assignmentText(tournament)));

    // The director rebrackets after the room downloaded its assignment.
    const other = new ScheduledMatch(1, testTeamNames[2], testTeamNames[3], 'scheduled-contract-3');
    other.phaseCode = scheduled.phaseCode;
    other.roomId = 'room-204';
    other.status = ScheduledMatchStatus.Ready;
    tournament.scheduledMatches.push(other);

    const imported = new MatchImportService(tournament).importMatches([
      { filePath: 'stale.qbj', fileContents: resultText },
    ]);

    expect(suggestScheduledMatchForImport(tournament, imported.results[0])).toMatchObject({
      kind: 'stale',
      scheduledMatchId: scheduled.id,
    });
  });
});

describe('a file assignment and a QBTCP assignment are the same document', () => {
  test('the same bytes over either route produce the same definition', () => {
    const { tournament, scheduled } = contractTournament();
    const revision = 1;

    // What Fruity would write to disk.
    const onDisk = exportQbjAssignments(tournament, 1);
    if (!onDisk.ok) throw new Error(onDisk.error);

    // What the QBTCP assignment endpoint serves: the same builder, no second model.
    const overWire = buildQbjAssignment(tournament, scheduled, revision);
    expect(overWire.ok).toBe(true);
    if (!overWire.ok) return;

    const fromFile = openAssignment(JSON.stringify(onDisk.assignments[0].document));
    const fromNetwork = openAssignment(JSON.stringify(overWire.value.document));

    // Identity, teams, rules and room all agree; only the revision may differ, and here it does not.
    expect(fromNetwork.qbjIdentity).toEqual(fromFile.qbjIdentity);
    expect(fromNetwork.left).toEqual(fromFile.left);
    expect(fromNetwork.right).toEqual(fromFile.right);
    expect(fromNetwork.scorekeeperFormat).toEqual(fromFile.scorekeeperFormat);
    expect(fromNetwork.room).toEqual(fromFile.room);
  });
});
