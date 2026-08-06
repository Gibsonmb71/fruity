import { describe, expect, test } from 'vitest';
import { CommonRuleSets } from '../renderer/DataModel/ScoringRules';
import { ScheduledMatch, ScheduledMatchStatus } from '../renderer/DataModel/ScheduledMatch';
import { resolvePublicationReadiness } from '../renderer/Services/ReportReadiness';
import { makeTestTournament, testTeamNames } from './TestFixtures';

function addScheduled(tournament: ReturnType<typeof makeTestTournament>, status: ScheduledMatchStatus) {
  const match = new ScheduledMatch(1, testTeamNames[0], testTeamNames[1], 'scheduled-report-1');
  match.phaseCode = tournament.getPrelimPhase()?.code ?? '1';
  match.status = status;
  tournament.scheduledMatches = [match];
  return match;
}

describe('publication readiness', () => {
  test('manual completeness is unknown rather than falsely verified', () => {
    const tournament = makeTestTournament(CommonRuleSets.NaqtUntimed);
    tournament.standardRuleSet = CommonRuleSets.NaqtUntimed;

    const readiness = resolvePublicationReadiness(tournament, false);
    const completeness = readiness.checks.find((check) => check.id === 'completeness');

    expect(completeness?.status).toBe('unknown');
    expect(completeness?.text).toContain('cannot be verified automatically');
    expect(readiness.applicableNaqt).toBe(true);
  });

  test('an accepted browser Match Plan verifies completeness', () => {
    const tournament = makeTestTournament();
    tournament.roomScoringMode = 'browser';
    addScheduled(tournament, ScheduledMatchStatus.Accepted);

    const readiness = resolvePublicationReadiness(tournament);
    const completeness = readiness.checks.find((check) => check.id === 'completeness');

    expect(completeness?.status).toBe('verified');
    expect(completeness?.text).toBe('All scheduled games are accepted');
  });

  test('an unresolved browser Match Plan is a problem', () => {
    const tournament = makeTestTournament();
    tournament.roomScoringMode = 'browser';
    addScheduled(tournament, ScheduledMatchStatus.Submitted);

    const readiness = resolvePublicationReadiness(tournament);

    expect(readiness.checks.find((check) => check.id === 'completeness')?.status).toBe('problem');
    expect(readiness.status).toBe('problem');
  });

  test('NAQT checks are omitted for non-NAQT rulesets', () => {
    const tournament = makeTestTournament(CommonRuleSets.Acf);

    const readiness = resolvePublicationReadiness(tournament);

    expect(readiness.applicableNaqt).toBe(false);
    expect(readiness.checks.some((check) => check.id === 'tossups-heard')).toBe(false);
  });
});
