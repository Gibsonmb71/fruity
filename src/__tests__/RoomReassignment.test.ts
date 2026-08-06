import { describe, expect, test } from 'vitest';
import { ScheduledMatch, ScheduledMatchStatus } from '../renderer/DataModel/ScheduledMatch';
import { TournamentRoom } from '../renderer/DataModel/TournamentRoom';
import { makeTestTournament, testTeamNames } from './TestFixtures';
import { assignRoom, planSwap } from '../renderer/Services/RoomAllocationService';

function makeRooms(names: string[]): TournamentRoom[] {
  return names.map((name, index) => new TournamentRoom(name, index, `room-${name}`));
}

function makeMatch(
  tournament: ReturnType<typeof makeTestTournament>,
  roundNumber: number,
  leftTeamName: string,
  rightTeamName: string,
  roomId?: string,
): ScheduledMatch {
  const phase = tournament.whichPhaseIsRoundNumberIn(roundNumber)!;
  const match = new ScheduledMatch(roundNumber, leftTeamName, rightTeamName);
  match.phaseCode = phase.code;
  match.poolName = phase.pools[0]?.name;
  match.roomId = roomId;
  return match;
}

describe('room reassignment', () => {
  test('moves a future match through the single assignment path', () => {
    const tournament = makeTestTournament();
    tournament.rooms = makeRooms(['101', '102']);
    const match = makeMatch(tournament, 1, testTeamNames[0], testTeamNames[1], 'room-101');
    tournament.scheduledMatches = [match];

    const issues = assignRoom(tournament, match.id, 'room-102');

    expect(issues).toEqual([]);
    expect(match.roomId).toBe('room-102');
    expect(match.roomAssignmentSource).toBe('manual');
  });

  test('allows a ready match to move without changing its permanent identity', () => {
    const tournament = makeTestTournament();
    tournament.rooms = makeRooms(['101', '102']);
    const match = makeMatch(tournament, 1, testTeamNames[0], testTeamNames[1], 'room-101');
    match.status = ScheduledMatchStatus.Ready;
    tournament.scheduledMatches = [match];

    expect(assignRoom(tournament, match.id, 'room-102')).toEqual([]);
    expect(match.id).toBeDefined();
    expect(match.roomId).toBe('room-102');
  });

  test('blocks a playing match with the live-scoring safety message', () => {
    const tournament = makeTestTournament();
    tournament.rooms = makeRooms(['Room 101', 'Room 102']);
    const match = makeMatch(tournament, 1, testTeamNames[0], testTeamNames[1], 'room-Room 101');
    match.status = ScheduledMatchStatus.Playing;
    tournament.scheduledMatches = [match];

    const issues = assignRoom(tournament, match.id, 'room-102');

    expect(issues[0].severity).toBe('error');
    expect(issues[0].message).toContain('Room 101');
    expect(issues[0].message).toContain('cannot be changed while scoring is active');
    expect(match.roomId).toBe('room-Room 101');
  });

  test('plans a safe swap without mutating either match', () => {
    const tournament = makeTestTournament();
    tournament.rooms = makeRooms(['101', '102']);
    const first = makeMatch(tournament, 1, testTeamNames[0], testTeamNames[1], 'room-101');
    const second = makeMatch(tournament, 1, testTeamNames[2], testTeamNames[3], 'room-102');
    tournament.scheduledMatches = [first, second];

    const plan = planSwap(tournament, first.id, 'room-102');

    expect(plan.kind).toBe('swap');
    expect(plan.issues).toEqual([]);
    expect(plan.changes).toEqual([
      { matchId: first.id, fromRoomId: 'room-101', toRoomId: 'room-102' },
      { matchId: second.id, fromRoomId: 'room-102', toRoomId: 'room-101' },
    ]);
    expect(first.roomId).toBe('room-101');
    expect(second.roomId).toBe('room-102');
  });

  test('rejects a swap into a protected game', () => {
    const tournament = makeTestTournament();
    tournament.rooms = makeRooms(['101', '102']);
    const first = makeMatch(tournament, 1, testTeamNames[0], testTeamNames[1], 'room-101');
    const second = makeMatch(tournament, 1, testTeamNames[2], testTeamNames[3], 'room-102');
    second.roomAssignmentLocked = true;
    tournament.scheduledMatches = [first, second];

    const plan = planSwap(tournament, first.id, 'room-102');

    expect(plan.kind).toBe('illegal');
    expect(plan.issues[0].message).toContain('protected game');
    expect(plan.changes).toEqual([]);
  });

  test('requires an explicit unlock before moving a locked assignment', () => {
    const tournament = makeTestTournament();
    tournament.rooms = makeRooms(['101', '102']);
    const match = makeMatch(tournament, 1, testTeamNames[0], testTeamNames[1], 'room-101');
    match.roomAssignmentLocked = true;
    tournament.scheduledMatches = [match];

    expect(assignRoom(tournament, match.id, 'room-102')).toHaveLength(1);
    expect(match.roomId).toBe('room-101');
    expect(assignRoom(tournament, match.id, 'room-102', { unlock: true })).toEqual([]);
    expect(match.roomId).toBe('room-102');
    expect(match.roomAssignmentLocked).toBeUndefined();
  });
});
