import { describe, expect, test } from 'vitest';
import { buildQuickFindItems, filterQuickFindItems } from '../renderer/Services/QuickFind';
import { makeTestTournament } from './TestFixtures';
import { Match } from '../renderer/DataModel/Match';
import { ScheduledMatch, ScheduledMatchStatus } from '../renderer/DataModel/ScheduledMatch';
import { TournamentRoom } from '../renderer/DataModel/TournamentRoom';

describe('Quick Find', () => {
  test('indexes navigation, teams, rounds, and games', () => {
    const tournament = makeTestTournament();
    const items = buildQuickFindItems(tournament);

    expect(items.some((item) => item.label === 'Setup')).toBe(true);
    expect(items.find((item) => item.label === 'Ninety Six A' && item.detail === 'Team')?.navigation).toMatchObject({
      target: 'games',
      teamName: 'Ninety Six A',
    });
    expect(items.find((item) => item.label === 'Round 1')?.navigation).toMatchObject({
      roundNumber: 1,
      focus: 'round',
    });
  });

  test('prioritizes a label match and limits results', () => {
    const tournament = makeTestTournament();
    const results = filterQuickFindItems(buildQuickFindItems(tournament), 'ninety six');

    expect(results[0]?.label).toBe('Ninety Six A');
    expect(results.length).toBeLessThanOrEqual(30);
  });

  test('carries exact Games navigation for a played game', () => {
    const tournament = makeTestTournament();
    const left = tournament.getListOfAllTeams()[0];
    const right = tournament.getListOfAllTeams()[1];
    const round = tournament.phases[0].rounds[0];
    const match = new Match(left, right, tournament.scoringRules.answerTypes);
    round.addMatch(match);

    const item = buildQuickFindItems(tournament).find((candidate) => candidate.id === `match-${match.id}`);
    expect(item?.navigation).toMatchObject({
      matchId: match.id,
      roundNumber: round.number,
      gamesReviewFilter: 'all',
      focus: 'scheduled-match',
    });
  });

  test('indexes executable actions in a stable category order', () => {
    const tournament = makeTestTournament();
    const items = buildQuickFindItems(tournament);
    const actionIds = items.filter((item) => item.category === 'ACTION').map((item) => item.actionId);

    expect(actionIds.slice(0, 4)).toEqual(['add-game', 'add-team', 'open-games', 'open-current-round']);
    expect(actionIds).toContain('open-match-plan');
    expect(actionIds).toContain('open-reports');
    expect(actionIds).toContain('open-live-display');
  });

  test('only exposes browser commands when their authoritative readiness allows them', () => {
    const tournament = makeTestTournament();
    tournament.roomScoringMode = 'browser';
    const room = new TournamentRoom('101', 0, 'room-101');
    tournament.rooms = [room];
    const scheduled = new ScheduledMatch(1, 'Ninety Six A', 'Greenwood A', 'scheduled-command-1');
    scheduled.phaseCode = tournament.phases[0].code;
    scheduled.roomId = room.id;
    scheduled.status = ScheduledMatchStatus.Scheduled;
    tournament.scheduledMatches = [scheduled];

    const blocked = buildQuickFindItems(tournament, {
      serverRunning: false,
      currentRoundNumber: 1,
      startServerAllowed: false,
      releaseAllowed: false,
    });
    expect(blocked.some((item) => item.actionId === 'start-server')).toBe(false);
    expect(blocked.some((item) => item.actionId === 'release-round')).toBe(false);

    const allowed = buildQuickFindItems(tournament, {
      serverRunning: true,
      currentRoundNumber: 1,
      releaseAllowed: true,
    });
    expect(allowed.some((item) => item.actionId === 'release-round')).toBe(true);
  });
});
