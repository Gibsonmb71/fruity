import { describe, expect, test } from 'vitest';
import { buildQuickFindItems, filterQuickFindItems } from '../renderer/Services/QuickFind';
import { makeTestTournament } from './TestFixtures';
import { Match } from '../renderer/DataModel/Match';

describe('Quick Find', () => {
  test('indexes navigation, teams, rounds, and games', () => {
    const tournament = makeTestTournament();
    const items = buildQuickFindItems(tournament);

    expect(items.some((item) => item.label === 'Setup')).toBe(true);
    expect(items.find((item) => item.label === 'Ninety Six A' && item.detail === 'Team')?.navigation).toEqual({
      teamName: 'Ninety Six A',
    });
    expect(items.find((item) => item.label === 'Round 1')?.navigation).toEqual({ roundNumber: 1 });
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
    expect(item?.navigation).toEqual({ matchId: match.id, roundNumber: round.number });
  });
});
