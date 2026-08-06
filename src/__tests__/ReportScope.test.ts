import { describe, expect, test } from 'vitest';
import { Phase, PhaseTypes } from '../renderer/DataModel/Phase';
import { makeTestTournament } from './TestFixtures';
import { isEntireReportScope, projectTournamentForReport } from '../renderer/Services/ReportScope';

describe('report scopes', () => {
  test('projects only selected stages without changing the tournament', () => {
    const tournament = makeTestTournament();
    const prelim = tournament.phases[0];
    const playoff = new Phase(PhaseTypes.Playoff, prelim.lastRoundNumber() + 1, prelim.lastRoundNumber() + 1, '2');
    tournament.phases.push(playoff);

    const projection = projectTournamentForReport(tournament, {
      phaseCodes: [playoff.code],
      includeCarryover: false,
    });

    expect(projection.phases.map((phase) => phase.code)).toEqual(['2']);
    expect(projection.stats.map((stats) => stats.phase.code)).toEqual(['2']);
    expect(tournament.phases.map((phase) => phase.code)).toEqual(['1', '2']);
    expect(tournament.stats).toEqual([]);
  });

  test('treats a complete, carryover-inclusive selection as the ordinary report', () => {
    const tournament = makeTestTournament();

    expect(
      isEntireReportScope(tournament, {
        phaseCodes: tournament.phases.map((phase) => phase.code),
        includeCarryover: true,
      }),
    ).toBe(true);
    expect(isEntireReportScope(tournament, { phaseCodes: [], includeCarryover: true })).toBe(true);
    expect(isEntireReportScope(tournament, { phaseCodes: ['1'], includeCarryover: false })).toBe(false);
  });
});
