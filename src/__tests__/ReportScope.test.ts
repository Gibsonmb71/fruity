import { describe, expect, test } from 'vitest';
import { Phase, PhaseTypes } from '../renderer/DataModel/Phase';
import { Match } from '../renderer/DataModel/Match';
import { makeTestTournament, testTeamNames } from './TestFixtures';
import {
  getReportDiagnostics,
  isEntireReportScope,
  projectTournamentForReport,
} from '../renderer/Services/ReportScope';
import buildPublicLiveSnapshot from '../renderer/Services/PublicLiveSnapshot';

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

  test('carryover matches in a report projection are independent copies with authoritative team identity', () => {
    const tournament = makeTestTournament();
    const prelim = tournament.phases[0];
    const playoff = new Phase(PhaseTypes.Playoff, prelim.lastRoundNumber() + 1, prelim.lastRoundNumber() + 1, '2');
    playoff.addBlankPool(4);
    playoff.pools[0].hasCarryover = true;
    tournament.phases.push(playoff);

    const left = tournament.findTeamByName(testTeamNames[0]);
    const right = tournament.findTeamByName(testTeamNames[1]);
    if (!left || !right) throw new Error('test teams were not created');
    playoff.pools[0].addTeam(left);
    playoff.pools[0].addTeam(right);
    const original = new Match(left, right, tournament.scoringRules.answerTypes);
    prelim.rounds[0].addMatch(original);
    original.addCarryoverPhase(playoff);

    const projection = projectTournamentForReport(tournament, {
      phaseCodes: [playoff.code],
      includeCarryover: true,
    });
    const projectedCarryover = projection.stats[0]?.carryoverMatches[0];

    expect(projectedCarryover).toBeDefined();
    expect(projectedCarryover).not.toBe(original);
    expect(projectedCarryover?.leftTeam.team).toBe(left);
    if (projectedCarryover) projectedCarryover.leftTeam.points = 999;
    expect(original.leftTeam.points).not.toBe(999);
  });

  test('all report pages and the public projection leave authoritative data byte-for-byte unchanged', () => {
    const tournament = makeTestTournament();
    tournament.liveDisplaySettings.enabled = true;
    const before = JSON.stringify(tournament.toFileObject(false, true));
    const projection = projectTournamentForReport(tournament, {
      phaseCodes: tournament.phases.map((phase) => phase.code),
      includeCarryover: true,
    });

    projection.makeHtmlStandings();
    projection.makeHtmlIndividuals();
    projection.makeHtmlScoreboard();
    projection.makeHtmlTeamDetail();
    projection.makeHtmlPlayerDetail();
    projection.makeHtmlRoundReport();
    buildPublicLiveSnapshot(tournament, new Date('2026-08-06T12:00:00.000Z'));

    expect(JSON.stringify(tournament.toFileObject(false, true))).toBe(before);
  });

  test('skips malformed carryover metadata and exposes a report diagnostic', () => {
    const tournament = makeTestTournament();
    const prelim = tournament.phases[0];
    const playoff = new Phase(PhaseTypes.Playoff, prelim.lastRoundNumber() + 1, prelim.lastRoundNumber() + 1, '2');
    tournament.phases.push(playoff);
    const left = tournament.findTeamByName(testTeamNames[0]);
    const right = tournament.findTeamByName(testTeamNames[1]);
    if (!left || !right) throw new Error('test teams were not created');
    const malformed = new Match(left, right, tournament.scoringRules.answerTypes);
    malformed.carryoverPhases = undefined as unknown as Phase[];
    prelim.rounds[0].addMatch(malformed);

    const projection = projectTournamentForReport(tournament, {
      phaseCodes: [playoff.code],
      includeCarryover: true,
    });

    expect(projection.stats[0]?.carryoverMatches).toEqual([]);
    expect(getReportDiagnostics(projection)).toEqual([expect.stringContaining('Skipped carryover')]);
  });
});
