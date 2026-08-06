import { describe, expect, test } from 'vitest';
import { makeTestTournament, testTeamNames } from './TestFixtures';
import { CommonRuleSets } from '../renderer/DataModel/ScoringRules';
import { ScheduledMatch, ScheduledMatchStatus } from '../renderer/DataModel/ScheduledMatch';
import { TournamentRoom } from '../renderer/DataModel/TournamentRoom';
import Tournament from '../renderer/DataModel/Tournament';
import { IReadinessServerState, resolveTournamentReadiness } from '../renderer/Services/TournamentReadiness';

function makeScheduledTournament(): {
  tournament: Tournament;
  match: ScheduledMatch;
  room: TournamentRoom;
} {
  const tournament = makeTestTournament(CommonRuleSets.NaqtUntimed);
  const room = new TournamentRoom('101', 0, 'room-101', 'token-101');
  const match = new ScheduledMatch(1, testTeamNames[0], testTeamNames[1], 'match-1');
  match.phaseCode = tournament.getPrelimPhase()?.code ?? '1';
  match.roomId = room.id;
  tournament.rooms = [room];
  tournament.scheduledMatches = [match];
  return { tournament, match, room };
}

const runningServer = (overrides: Partial<IReadinessServerState> = {}): IReadinessServerState => ({
  running: true,
  currentRoundNumber: 1,
  releasedRoundNumber: null,
  inboxCount: 0,
  ...overrides,
});

describe('resolveTournamentReadiness', () => {
  test('prioritizes the first missing setup task', () => {
    const readiness = resolveTournamentReadiness(new Tournament());

    expect(readiness.state).toBe('setup');
    expect(readiness.primaryAction).toEqual({ kind: 'navigate', label: 'Open Tournament', target: 'setup:tournament' });
    expect(readiness.setup.teamsReady).toBe(false);
    expect(readiness.setup.formatReady).toBe(false);
    expect(readiness.activeIssues.map((currentIssue) => currentIssue.id)).toEqual(
      expect.arrayContaining(['missing-tournament-name', 'missing-teams', 'missing-format']),
    );
  });

  test('requires a concrete match plan after setup is ready', () => {
    const tournament = makeTestTournament(CommonRuleSets.NaqtUntimed);
    tournament.rooms = [new TournamentRoom('101', 0, 'room-101', 'token-101')];

    const readiness = resolveTournamentReadiness(tournament, runningServer());

    expect(readiness.setup).toMatchObject({
      tournamentReady: true,
      rulesReady: true,
      teamsReady: true,
      formatReady: true,
    });
    expect(readiness.state).toBe('match-plan-missing');
    expect(readiness.primaryAction).toEqual({
      kind: 'navigate',
      label: 'Create Match Plan',
      target: 'control:match-plan',
    });
  });

  test('blocks an unassigned current-round game with a direct match-plan action', () => {
    const { tournament, match } = makeScheduledTournament();
    delete match.roomId;

    const readiness = resolveTournamentReadiness(tournament, runningServer());

    expect(readiness.state).toBe('schedule-blocked');
    expect(readiness.primaryAction).toMatchObject({
      label: 'Fix assignment',
      target: 'control:match-plan',
      scheduledMatchIds: [match.id],
    });
    expect(readiness.issues.some((currentIssue) => /not assigned/.test(currentIssue.message))).toBe(true);
  });

  test('distinguishes a stopped server from a schedule problem', () => {
    const { tournament } = makeScheduledTournament();

    const readiness = resolveTournamentReadiness(tournament, {
      running: false,
      currentRoundNumber: 1,
      releasedRoundNumber: null,
      inboxCount: 0,
    });

    expect(readiness.state).toBe('server-unavailable');
    expect(readiness.primaryAction).toEqual({ kind: 'start-server', label: 'Start server', target: 'control:live' });
  });

  test('prioritizes review of submitted results', () => {
    const { tournament, match } = makeScheduledTournament();
    match.status = ScheduledMatchStatus.Submitted;

    const readiness = resolveTournamentReadiness(
      tournament,
      runningServer({ inboxCount: 2, sessions: [{ roomId: 'room-101', status: 'submitted' }] }),
    );

    expect(readiness.state).toBe('results-awaiting-review');
    expect(readiness.primaryAction).toEqual({
      kind: 'review-results',
      label: 'Review results',
      target: 'control:live',
    });
  });

  test('reports an offline room as an actionable operational block', () => {
    const { tournament, room } = makeScheduledTournament();

    const readiness = resolveTournamentReadiness(
      tournament,
      runningServer({ roomPresence: [{ roomId: room.id, connected: false }] }),
    );

    expect(readiness.state).toBe('schedule-blocked');
    expect(readiness.primaryAction?.target).toBe('control:match-plan');
  });

  test('recognizes the end of a scheduled tournament once every planned game is accepted', () => {
    const { tournament, match } = makeScheduledTournament();
    match.status = ScheduledMatchStatus.Accepted;

    const readiness = resolveTournamentReadiness(tournament, runningServer({ currentRoundNumber: 1 }));

    expect(readiness.currentRoundSummary?.complete).toBe(true);
    expect(readiness.state).toBe('tournament-complete');
    expect(readiness.primaryAction).toEqual({ kind: 'navigate', label: 'Review reports', target: 'reports' });
  });

  test('keeps traditional manual-entry tournaments free of room-operation errors', () => {
    const tournament = makeTestTournament(CommonRuleSets.NaqtUntimed);

    const readiness = resolveTournamentReadiness(tournament);

    expect(readiness.coreReady).toBe(true);
    expect(readiness.roomOperationsEnabled).toBe(false);
    expect(readiness.state).toBe('traditional-ready');
    expect(readiness.primaryAction).toEqual({ kind: 'navigate', label: 'Open Games', target: 'games' });
    expect(readiness.activeIssues.some((currentIssue) => /Match Plan|rooms|server/i.test(currentIssue.message))).toBe(
      false,
    );
  });
});
