import { describe, expect, test } from 'vitest';
import { ScheduledMatch } from '../renderer/DataModel/ScheduledMatch';
import { Phase, PhaseTypes } from '../renderer/DataModel/Phase';
import { matchPlanStageOptions, matchesForRoomCell } from '../renderer/Services/MatchPlanPresentation';
import { makeTestTournament, testTeamNames } from './TestFixtures';

describe('Match Plan presentation metadata', () => {
  test('uses human phase names and disambiguates duplicate names', () => {
    const tournament = makeTestTournament();
    const first = new ScheduledMatch(1, testTeamNames[0], testTeamNames[1], 'stage-1');
    first.phaseCode = tournament.phases[0].code;
    const second = new ScheduledMatch(1, testTeamNames[2], testTeamNames[3], 'stage-2');
    second.phaseCode = 'playoff-2';
    tournament.phases[0].name = 'Round Robin';
    const duplicatePhase = new Phase(PhaseTypes.Playoff, 4, 4, 'playoff-2', 'Round Robin');
    const options = matchPlanStageOptions([tournament.phases[0], duplicatePhase], [first, second]);

    expect(options).toEqual([
      { code: tournament.phases[0].code, label: 'Round Robin · 1' },
      { code: 'playoff-2', label: 'Round Robin · playoff-2' },
    ]);
  });

  test('keeps every unassigned matchup in the board lane', () => {
    const tournament = makeTestTournament();
    const first = new ScheduledMatch(1, testTeamNames[0], testTeamNames[1], 'unassigned-1');
    const second = new ScheduledMatch(1, testTeamNames[2], testTeamNames[3], 'unassigned-2');

    expect(matchesForRoomCell([first, second], 1, '__unassigned__').map((match) => match.id)).toEqual([
      first.id,
      second.id,
    ]);
    expect(matchesForRoomCell([first, second], 2, '__unassigned__')).toEqual([]);
    expect(tournament.phases.length).toBeGreaterThan(0);
  });
});
