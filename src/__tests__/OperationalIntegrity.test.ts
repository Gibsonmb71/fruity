import { describe, expect, test } from 'vitest';
import { ScheduledMatch, ScheduledMatchStatus } from '../renderer/DataModel/ScheduledMatch';
import { TournamentRoom } from '../renderer/DataModel/TournamentRoom';
import { inspectOperationalIntegrity, repairOperationalIntegrity } from '../renderer/Services/OperationalIntegrity';
import { makeTestTournament, testTeamNames } from './TestFixtures';

function scheduledMatch(tournament: ReturnType<typeof makeTestTournament>, left: string, right: string, id: string) {
  const match = new ScheduledMatch(1, left, right, id);
  match.phaseCode = tournament.phases[0].code;
  match.poolName = tournament.phases[0].pools[0]?.name;
  return match;
}

describe('operational integrity repair', () => {
  test('repairs harmless identities but quarantines ambiguous scheduling history', () => {
    const tournament = makeTestTournament();
    tournament.rooms = [
      new TournamentRoom('101', 1, 'duplicate-room', 'same-token'),
      new TournamentRoom('102', 0, 'duplicate-room', 'same-token'),
    ];
    tournament.rooms[0].availableRoundNumbers = [1, 999, 1.5];

    const accepted = scheduledMatch(tournament, testTeamNames[0], testTeamNames[1], 'same-scheduled-id');
    accepted.status = ScheduledMatchStatus.Accepted;
    accepted.resultMatchId = 'missing-match';

    const duplicateId = scheduledMatch(tournament, testTeamNames[2], testTeamNames[3], 'same-scheduled-id');
    duplicateId.roomId = 'duplicate-room';

    const invalidLink = scheduledMatch(tournament, testTeamNames[0], testTeamNames[2], 'invalid-link');
    invalidLink.resultMatchId = 'not-accepted';
    invalidLink.roomId = 'does-not-exist';

    tournament.scheduledMatches = [accepted, duplicateId, invalidLink];
    const result = repairOperationalIntegrity(tournament);

    expect(result.repaired).toBe(true);
    expect(result.requiresReview).toBe(true);
    expect(new Set(tournament.rooms.map((room) => room.id)).size).toBe(2);
    expect(new Set(tournament.rooms.map((room) => room.accessToken)).size).toBe(2);
    expect(tournament.rooms.find((room) => room.name === '101')?.availableRoundNumbers).toEqual([1]);
    expect(new Set(tournament.scheduledMatches.map((match) => match.id)).size).toBe(3);
    expect(accepted.status).toBe(ScheduledMatchStatus.Accepted);
    expect(accepted.quarantined).toBe(true);
    expect(invalidLink.resultMatchId).toBeUndefined();
    expect(invalidLink.status).toBe(ScheduledMatchStatus.NeedsAttention);
    expect(invalidLink.quarantined).toBe(true);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  test('inspection is read-only even when the candidate would need repair', () => {
    const tournament = makeTestTournament();
    const match = scheduledMatch(tournament, testTeamNames[0], testTeamNames[1], 'inspection-match');
    match.phaseCode = 'wrong-phase';
    match.resultMatchId = 'dangling';
    tournament.scheduledMatches = [match];
    const before = JSON.stringify(tournament.scheduledMatches.map((item) => item.toYftFileObject()));

    const result = inspectOperationalIntegrity(tournament);

    expect(result.requiresReview).toBe(true);
    expect(JSON.stringify(tournament.scheduledMatches.map((item) => item.toYftFileObject()))).toBe(before);
  });
});
