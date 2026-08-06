import { afterEach, describe, expect, test } from 'vitest';
import { Match } from '../renderer/DataModel/Match';
import { Phase, PhaseTypes } from '../renderer/DataModel/Phase';
import { CommonRuleSets } from '../renderer/DataModel/ScoringRules';
import { ScheduledMatch, ScheduledMatchStatus } from '../renderer/DataModel/ScheduledMatch';
import { TournamentRoom } from '../renderer/DataModel/TournamentRoom';
import TournamentServerService from '../renderer/Services/TournamentServerService';
import { assignRoom } from '../renderer/Services/RoomAllocationService';
import { projectTournamentForReport } from '../renderer/Services/ReportScope';
import { resolvePublicationReadiness } from '../renderer/Services/ReportReadiness';
import { resolveTournamentReadiness } from '../renderer/Services/TournamentReadiness';
import { generatePhasePairings } from '../renderer/Services/RoundRobinScheduler';
import { makeStandardModaqMatch, makeTestTournament, testTeamNames } from './TestFixtures';

const originalWindow = (global as any).window;

function makeScheduled(tournament: ReturnType<typeof makeTestTournament>, roundNumber: number, id: string) {
  const phase = tournament.whichPhaseIsRoundNumberIn(roundNumber);
  const match = new ScheduledMatch(roundNumber, testTeamNames[0], testTeamNames[1], id);
  match.phaseCode = phase?.code ?? '';
  return match;
}

afterEach(() => {
  if (originalWindow === undefined) delete (global as any).window;
  else (global as any).window = originalWindow;
});

describe('traditional YellowFruit workflow', () => {
  test('keeps manual games, reports, rebracket metadata, and QBJ boundaries independent of rooms', () => {
    const tournament = makeTestTournament(CommonRuleSets.NaqtUntimed);
    tournament.standardRuleSet = CommonRuleSets.NaqtUntimed;
    const phase = tournament.phases[0];
    const round = phase.rounds[0];
    const left = tournament.findTeamByName(testTeamNames[0]);
    const right = tournament.findTeamByName(testTeamNames[1]);
    if (!left || !right) throw new Error('test teams were not created');

    const manualMatch = new Match(left, right, tournament.scoringRules.answerTypes);
    manualMatch.tossupsRead = 20;
    manualMatch.leftTeam.points = 180;
    manualMatch.rightTeam.points = 140;
    round.addMatch(manualMatch);
    tournament.rebracketedPhaseCodes = [phase.code];

    const readiness = resolveTournamentReadiness(tournament);
    expect(tournament.roomScoringMode).toBe('traditional');
    expect(readiness.coreReady).toBe(true);
    expect(readiness.roomOperationsEnabled).toBe(false);
    expect(readiness.issues.some((issue) => issue.target === 'control:match-plan')).toBe(false);

    const reportProjection = projectTournamentForReport(tournament, {
      phaseCodes: [phase.code],
      includeCarryover: false,
    });
    expect(reportProjection.phases[0].rounds[0].matches).toHaveLength(1);
    expect(tournament.phases[0].rounds[0].matches).toHaveLength(1);
    expect(resolvePublicationReadiness(tournament).checks.find((check) => check.id === 'completeness')?.status).toBe(
      'unknown',
    );

    const yft = tournament.toFileObject() as unknown as { YfData: Record<string, unknown> };
    expect(yft.YfData.roomScoringMode).toBe('traditional');
    expect(yft.YfData.rebracketedPhaseCodes).toEqual([phase.code]);
    expect(tournament.toFileObject(true)).not.toHaveProperty('YfData');
  });
});

describe('browser room-scoring workflow', () => {
  test('enables rooms, releases, accepts a result, advances, and exposes the next action', () => {
    (global as any).window = { electron: { ipcRenderer: { sendMessage: () => {} } } };
    const tournament = makeTestTournament();
    tournament.roomScoringMode = 'browser';
    const room = new TournamentRoom('101', 0, 'room-101');
    tournament.rooms = [room];
    const first = makeScheduled(tournament, 1, 'workflow-round-1');
    const second = makeScheduled(tournament, 2, 'workflow-round-2');
    const [, , thirdTeam, fourthTeam] = testTeamNames;
    second.leftTeamName = thirdTeam;
    second.rightTeamName = fourthTeam;
    tournament.scheduledMatches = [first, second];
    expect(assignRoom(tournament, first.id, room.id)).toEqual([]);
    expect(assignRoom(tournament, second.id, room.id)).toEqual([]);

    const service = new TournamentServerService(tournament);
    expect(service.releaseRound(1)).toBe(true);
    expect(first.status).toBe(ScheduledMatchStatus.Ready);
    service.handleSessionStarted(first.id);
    expect(first.status).toBe(ScheduledMatchStatus.Playing);

    service.handleSubmission({
      sessionId: 'workflow-session-1',
      roundNumber: 1,
      leftTeam: first.leftTeamName,
      rightTeam: first.rightTeamName,
      roomId: room.id,
      scheduledMatchId: first.id,
      qbj: makeStandardModaqMatch(),
      submittedAt: new Date(0).toISOString(),
    });
    expect(first.status).toBe(ScheduledMatchStatus.Submitted);
    expect(
      resolveTournamentReadiness(tournament, {
        running: true,
        currentRoundNumber: 1,
        releasedRoundNumber: 1,
        inboxCount: service.inbox.length,
        conflictCount: 0,
      }).state,
    ).toBe('results-awaiting-review');

    expect(service.acceptSubmission('workflow-session-1')).toBe(true);
    expect(first.status).toBe(ScheduledMatchStatus.Accepted);
    expect(service.nextRoundToRelease()).toBe(2);
    expect(service.releaseRound(2)).toBe(true);
    expect(second.status).toBe(ScheduledMatchStatus.Ready);
    expect(resolvePublicationReadiness(tournament).checks.find((check) => check.id === 'completeness')?.status).toBe(
      'problem',
    );
  });

  test('surfaces a rebracket boundary after the scheduled phase is accepted', () => {
    const tournament = makeTestTournament();
    tournament.roomScoringMode = 'browser';
    const phase = tournament.phases[0];
    tournament.phases.push(new Phase(PhaseTypes.Playoff, 4, 4, '2', 'Playoffs'));
    tournament.rooms = [new TournamentRoom('101', 0, 'room-101'), new TournamentRoom('102', 1, 'room-102')];
    const generated = generatePhasePairings([
      {
        poolId: phase.pools[0].name,
        teamIds: phase.pools[0].poolTeams.map((team) => team.team.name),
        roundRobins: phase.pools[0].roundRobins,
      },
    ]);
    tournament.scheduledMatches = generated.flatMap((generatedRound) =>
      generatedRound.pairings.map((pairing, index) => {
        const roundNumber = phase.rounds[generatedRound.roundIndex - 1].number;
        const match = new ScheduledMatch(
          roundNumber,
          pairing.leftTeamId,
          pairing.rightTeamId,
          `rebracket-${roundNumber}-${index}`,
        );
        match.phaseCode = phase.code;
        match.poolName = phase.pools[0].name;
        match.status = ScheduledMatchStatus.Accepted;
        match.roomId = tournament.rooms[index].id;
        return match;
      }),
    );

    const readiness = resolveTournamentReadiness(tournament, {
      running: true,
      currentRoundNumber: 3,
      releasedRoundNumber: 3,
      inboxCount: 0,
      conflictCount: 0,
    });
    expect(readiness.state).toBe('rebracket-required');
    expect(readiness.primaryAction?.kind).toBe('open-rebracket');
    expect(readiness.rebracketNextPhase?.name).toBe('Playoffs');

    tournament.rebracketedPhaseCodes.push(phase.code);
    expect(
      resolveTournamentReadiness(tournament, {
        running: true,
        currentRoundNumber: 3,
        releasedRoundNumber: 3,
        inboxCount: 0,
        conflictCount: 0,
      }).state,
    ).toBe('tournament-complete');
  });
});
