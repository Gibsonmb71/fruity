import { describe, expect, test } from 'vitest';
import { buildQuickFindItems, filterQuickFindItems } from '../renderer/Services/QuickFind';
import { makeTestTournament } from './TestFixtures';

describe('Quick Find', () => {
  test('indexes navigation, teams, rounds, and games', () => {
    const tournament = makeTestTournament();
    const items = buildQuickFindItems(tournament);

    expect(items.some((item) => item.label === 'Setup')).toBe(true);
    expect(items.some((item) => item.label === 'Ninety Six A' && item.detail === 'Team')).toBe(true);
    expect(items.some((item) => item.label === 'Round 1')).toBe(true);
  });

  test('prioritizes a label match and limits results', () => {
    const tournament = makeTestTournament();
    const results = filterQuickFindItems(buildQuickFindItems(tournament), 'ninety six');

    expect(results[0]?.label).toBe('Ninety Six A');
    expect(results.length).toBeLessThanOrEqual(30);
  });
});
