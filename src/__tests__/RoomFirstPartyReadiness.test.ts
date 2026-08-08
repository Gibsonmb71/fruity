import { describe, expect, test } from 'vitest';
import { checkCanStart } from '../main/server/RoomDirectory';
import {
  IAssignmentDescriptor,
  IRoomDescriptor,
  ITournamentSnapshot,
  RoomBlockedReason,
} from '../main/server/ServerTypes';
import { ScheduledMatchStatus } from '../renderer/DataModel/ScheduledMatch';
import AnswerType from '../renderer/DataModel/AnswerType';
import { CommonRuleSets, ScoringRules } from '../renderer/DataModel/ScoringRules';
import scoringRulesToScorekeeperFormat from '../renderer/Services/ScorekeeperFormat';

const room: IRoomDescriptor = { id: 'room-1', name: 'Room 1', accessToken: 'token', enabled: true };
const assignment: IAssignmentDescriptor = {
  scheduledMatchId: 'match-1',
  roomId: room.id,
  roundNumber: 1,
  roundName: '1',
  leftTeam: 'Alpha',
  rightTeam: 'Beta',
  status: ScheduledMatchStatus.Ready,
};

function snapshot(rules: ScoringRules): ITournamentSnapshot {
  return {
    name: 'Test',
    rounds: [{ number: 1, name: '1' }],
    teams: [
      { name: 'Alpha', players: [{ name: 'A' }] },
      { name: 'Beta', players: [{ name: 'B' }] },
    ],
    // Deliberately unavailable: these tests prove MODAQ representability is not first-party authority.
    gameFormat: null,
    gameFormatErrors: ['Not representable in MODAQ'],
    gameFormatWarnings: [],
    scoringFormat: scoringRulesToScorekeeperFormat(rules),
    timedRounds: rules.timed,
    rooms: [room],
    assignments: [assignment],
    currentRoundNumber: 1,
    releasedRoundNumber: 1,
  };
}

describe('first-party room readiness', () => {
  const cases: [string, (rules: ScoringRules) => void][] = [
    [
      '7 / -3 tossups',
      (rules) => {
        rules.answerTypes = [new AnswerType(7), new AnswerType(-3)];
      },
    ],
    [
      'irregular bonuses',
      (rules) => {
        rules.pointsPerBonusPart = undefined;
      },
    ],
    [
      'lightning',
      (rules) => {
        rules.lightningCountPerTeam = 1;
      },
    ],
  ];

  test.each(cases)('%s starts first-party while the legacy path remains blocked', (_label, mutate) => {
    const rules = new ScoringRules(CommonRuleSets.AcfPowers);
    mutate(rules);
    const projected = snapshot(rules);

    expect(checkCanStart(projected, room, assignment, 'first-party')).toBeNull();
    expect(checkCanStart(projected, room, assignment, 'legacy')?.reason).toBe(RoomBlockedReason.RulesUnusable);
  });

  test('an invalid first-party scoring format is blocked', () => {
    const rules = new ScoringRules(CommonRuleSets.AcfPowers);
    rules.answerTypes = [];

    expect(checkCanStart(snapshot(rules), room, assignment, 'first-party')?.reason).toBe(
      RoomBlockedReason.RulesUnusable,
    );
  });
});
