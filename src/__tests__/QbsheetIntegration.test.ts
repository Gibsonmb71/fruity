import { describe, expect, test } from 'vitest';
import { applyScoreEvents, deriveGame, portableQbj, toQbjMatch, validateGamePackage, type IGameSetup } from 'qbsheet';
import { ScheduledMatch, ScheduledMatchStatus } from '../renderer/DataModel/ScheduledMatch';
import { TournamentRoom } from '../renderer/DataModel/TournamentRoom';
import MatchImportService from '../renderer/Services/MatchImportService';
import { exportQbsheetGamePackages } from '../renderer/Services/QbsheetGamePackage';
import { readQbsheetSourceMetadata, qbsheetResultFingerprint } from '../renderer/Services/QbsheetQbjMetadata';
import {
  commitScheduledResult,
  suggestScheduledMatchForImport,
} from '../renderer/Services/ScheduledResultReconciliation';
import { makeTestTournament, testTeamNames } from './TestFixtures';
import { event } from './RoomScoreEventFixtures';
import { roundAssignmentRevision } from '../shared/RoundAssignmentRevision';
import { normalizeQbsheetOrigin } from '../shared/QbsheetOrigin';

describe('QBSheet integration boundaries', () => {
  test('assignment revisions are stable for ordering and lifecycle changes', () => {
    const entries = [
      {
        scheduledMatchId: 'match-1',
        roundNumber: 7,
        leftTeam: 'Ninety Six A',
        rightTeam: 'Greenwood',
        roomId: 'room-204',
        status: 'Playing',
      },
      {
        scheduledMatchId: 'match-2',
        roundNumber: 7,
        leftTeam: 'Clinton',
        rightTeam: 'Emerald',
        roomId: 'room-205',
        status: 'Scheduled',
      },
    ];

    expect(roundAssignmentRevision(entries, 7)).toBe(
      roundAssignmentRevision(
        [...entries].reverse().map((entry) => ({ ...entry, status: 'Accepted' })),
        7,
      ),
    );
    expect(
      roundAssignmentRevision(
        entries.map((entry) => (entry.scheduledMatchId === 'match-2' ? { ...entry, rightTeam: 'Harbor' } : entry)),
        7,
      ),
    ).not.toBe(roundAssignmentRevision(entries, 7));
  });

  test('configured QBSheet origins accept only a bare HTTP(S) origin', () => {
    expect(normalizeQbsheetOrigin('https://example.github.io/')).toBe('https://example.github.io');
    expect(normalizeQbsheetOrigin('http://127.0.0.1:4173')).toBe('http://127.0.0.1:4173');
    expect(normalizeQbsheetOrigin('https://example.github.io/qbsheet/')).toBeNull();
    expect(normalizeQbsheetOrigin('https://user:secret@example.github.io')).toBeNull();
  });

  test('portable fingerprints ignore source and internal recovery extensions', () => {
    const first = {
      match_teams: [
        { name: 'Ninety Six A', points: 35 },
        { name: 'Greenwood', points: 20 },
      ],
      tossups_read: 2,
      _qbsheet_source: { scheduledMatchId: 'match-1', roundRevision: 1 },
      _yf_scorekeeper_recovery: { events: [{ type: 'tossup' }] },
    };
    const second = {
      tossups_read: 2,
      match_teams: [
        { name: 'Ninety Six A', points: 35 },
        { name: 'Greenwood', points: 20 },
      ],
      _scoresheet_source: { scheduledMatchId: 'different', roundRevision: 99 },
      _yf_scorekeeper_recovery: { events: [{ type: 'different' }] },
    };

    expect(qbsheetResultFingerprint(first)).toBe(qbsheetResultFingerprint(second));
    expect(qbsheetResultFingerprint({ ...second, match_teams: [{ name: 'Ninety Six A', points: 36 }] })).not.toBe(
      qbsheetResultFingerprint(first),
    );
  });

  test('malformed source metadata is ignored at the import boundary', () => {
    expect(readQbsheetSourceMetadata({ _qbsheet_source: { roundNumber: 7 } })).toBeNull();
    expect(
      readQbsheetSourceMetadata({
        _qbsheet_source: {
          producer: 'QBSheet',
          gamePackageVersion: 1,
          tournamentName: 'Spring Invitational',
          roundNumber: 7,
          roundRevision: 3,
          scheduledMatchId: 'match-1',
          resultFingerprint: 'abc123',
        },
      }),
    ).toMatchObject({ scheduledMatchId: 'match-1', roundRevision: 3, resultFingerprint: 'abc123' });
    expect(
      readQbsheetSourceMetadata({
        _scoresheet_source: {
          gamePackageVersion: 1,
          tournamentName: 'Spring Invitational',
          roundNumber: 7,
          roundRevision: 3,
        },
      }),
    ).toMatchObject({ tournamentName: 'Spring Invitational', roundNumber: 7 });
  });
});

describe('the full QBSheet file contract', () => {
  test('Fruity .qbg → QBSheet score → QBJ → Fruity import preserves the final Match', () => {
    const tournament = makeTestTournament();
    tournament.name = 'QBSheet Contract Test';
    tournament.operationalId = 'contract-tournament';
    tournament.roomScoringMode = 'browser';
    tournament.releasedRoundNumber = 1;
    tournament.resultHandoffInstruction = 'Download the QBJ and upload it to the room folder.';

    const room = new TournamentRoom('Room 204', 0, 'room-204', 'test-room-token', '12345678');
    tournament.rooms = [room];
    const scheduled = new ScheduledMatch(1, testTeamNames[0], testTeamNames[1], 'scheduled-contract-1');
    scheduled.phaseCode = tournament.getPrelimPhase()?.code ?? '1';
    scheduled.roomId = room.id;
    scheduled.status = ScheduledMatchStatus.Ready;
    tournament.scheduledMatches = [scheduled];

    const exported = exportQbsheetGamePackages(tournament, 1);
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(exported.packages).toHaveLength(1);

    // This is the actual .qbg boundary: serialize the file exactly as export/import would.
    const parsedPackage = JSON.parse(JSON.stringify(exported.packages[0])) as unknown;
    const packageValidation = validateGamePackage(parsedPackage);
    expect(packageValidation.ok).toBe(true);
    if (!packageValidation.ok) return;
    const packageValue = packageValidation.value;
    expect(packageValue.producer).toBe('QBSheet');
    expect(packageValue.scheduledMatchId).toBe(scheduled.id);

    const setup: IGameSetup = {
      left: {
        name: packageValue.left.name,
        players: packageValue.left.players.map((player) => player.name),
      },
      right: {
        name: packageValue.right.name,
        players: packageValue.right.players.map((player) => player.name),
      },
    };
    const answerTypeIndex = (value: number) => {
      const answerType = packageValue.scorekeeperFormat.answerTypes.find((candidate) => candidate.value === value);
      if (!answerType) throw new Error(`No answer type worth ${value}`);
      return answerType.index;
    };
    const events = [
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
    ];
    const acceptedEvents = applyScoreEvents(
      { format: packageValue.scorekeeperFormat, setup, procedure: packageValue.procedure },
      [],
      events,
    );
    expect(acceptedEvents.ok).toBe(true);
    if (!acceptedEvents.ok) return;

    const game = deriveGame(packageValue.scorekeeperFormat, setup, acceptedEvents.events);
    const portable = portableQbj(
      toQbjMatch(packageValue.scorekeeperFormat, game, {
        round: packageValue.round.number,
        location: packageValue.room?.name,
      }),
      packageValue,
    );
    const sourceMetadata = readQbsheetSourceMetadata(portable);
    expect(sourceMetadata).toMatchObject({
      producer: 'QBSheet',
      scheduledMatchId: scheduled.id,
      roundNumber: 1,
      roundRevision: expect.any(Number),
    });

    // Fruity imports the downloaded QBJ through the same service used for Drive/manual imports.
    const imported = new MatchImportService(tournament).importMatches([
      { filePath: 'Room 204 — QBSheet Contract Test.qbj', fileContents: JSON.stringify(portable) },
    ]);
    expect(imported.hadInvalidJson).toBe(false);
    expect(imported.results).toHaveLength(1);
    const [result] = imported.results;
    expect(result.sourceMetadata).toMatchObject({ scheduledMatchId: scheduled.id, producer: 'QBSheet' });
    expect(result.resultFingerprint).toBe(sourceMetadata?.resultFingerprint);
    expect(result.match).toBeDefined();
    if (!result.match) return;

    expect(suggestScheduledMatchForImport(tournament, result)).toEqual({
      kind: 'candidate',
      suggestion: expect.objectContaining({ scheduledMatchId: scheduled.id }),
    });
    const committed = commitScheduledResult(tournament, result, scheduled.id);
    expect(committed).toEqual({ ok: true, matchId: result.match.id });

    const finalMatch = tournament.getRoundObjByNumber(1)?.matches[0];
    expect(finalMatch).toBe(result.match);
    expect(scheduled.status).toBe(ScheduledMatchStatus.Accepted);
    expect(scheduled.resultMatchId).toBe(finalMatch?.id);
    expect(finalMatch?.leftTeam.points).toBe(35);
    expect(finalMatch?.rightTeam.points).toBe(40);
    expect(finalMatch?.leftTeam.getBonusPoints()).toBe(20);
    expect(finalMatch?.rightTeam.getBonusPoints()).toBe(30);
    expect(finalMatch?.tossupsRead).toBe(3);
    expect(finalMatch?.getErrorMessages()).toEqual([]);
  });
});
