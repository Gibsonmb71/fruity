import { describe, expect, test } from 'vitest';
import { ScheduledMatch, ScheduledMatchStatus } from '../renderer/DataModel/ScheduledMatch';
import { TournamentRoom } from '../renderer/DataModel/TournamentRoom';
import { makeTestTournament, testTeamNames } from './TestFixtures';
import {
  applySwapPlan,
  assignRoom,
  captureRoomAssignmentSnapshot,
  applyRebalance,
  planAutoAssignUnassigned,
  planRebalance,
  planRoomDrop,
  planSwap,
  rebalancePlanHasBlockingIssues,
  restoreRoomAssignmentSnapshot,
} from '../renderer/Services/RoomAllocationService';

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

  test('derives board feedback for an empty room, swap, and protected destination', () => {
    const tournament = makeTestTournament();
    tournament.rooms = makeRooms(['101', '102', '103']);
    const first = makeMatch(tournament, 1, testTeamNames[0], testTeamNames[1], 'room-101');
    const second = makeMatch(tournament, 1, testTeamNames[2], testTeamNames[3], 'room-102');
    const protectedMatch = makeMatch(tournament, 1, testTeamNames[0], testTeamNames[2], 'room-103');
    protectedMatch.status = ScheduledMatchStatus.Playing;
    tournament.scheduledMatches = [first, second, protectedMatch];

    expect(planRoomDrop(tournament, first.id, 'room-103').state).toBe('protected');
    expect(planRoomDrop(tournament, first.id, 'room-102').state).toBe('valid-swap');
    expect(planRoomDrop(tournament, first.id, 'room-103', 2).state).toBe('invalid');
    expect(planRoomDrop(tournament, first.id, 'room-103', 1).message).toContain('protected');
  });

  test('restores a move and preserves source, lock, and play-name metadata', () => {
    const tournament = makeTestTournament();
    tournament.rooms = makeRooms(['101', '102']);
    const match = makeMatch(tournament, 1, testTeamNames[0], testTeamNames[1], 'room-101');
    match.roomAssignmentSource = 'manual';
    match.roomAssignmentLocked = true;
    match.roomNameAtPlay = '101';
    tournament.scheduledMatches = [match];

    const snapshot = captureRoomAssignmentSnapshot(tournament, [match.id]);
    match.roomAssignmentLocked = undefined;
    expect(assignRoom(tournament, match.id, 'room-102')).toEqual([]);
    expect(restoreRoomAssignmentSnapshot(tournament, snapshot)).toEqual([]);

    expect(match.roomId).toBe('room-101');
    expect(match.roomAssignmentSource).toBe('manual');
    expect(match.roomAssignmentLocked).toBe(true);
    expect(match.roomNameAtPlay).toBe('101');
  });

  test('undo refuses a restore after lifecycle advancement or a new occupant', () => {
    const tournament = makeTestTournament();
    tournament.rooms = makeRooms(['101', '102']);
    const first = makeMatch(tournament, 1, testTeamNames[0], testTeamNames[1], 'room-101');
    const second = makeMatch(tournament, 1, testTeamNames[2], testTeamNames[3], 'room-102');
    tournament.scheduledMatches = [first, second];

    const snapshot = captureRoomAssignmentSnapshot(tournament, [first.id]);
    const plan = planSwap(tournament, first.id, 'room-102');
    expect(plan.kind).toBe('swap');
    expect(applySwapPlan(tournament, plan)).toEqual([]);
    first.status = ScheduledMatchStatus.Playing;

    const issues = restoreRoomAssignmentSnapshot(tournament, snapshot);

    expect(issues[0].message).toContain('no longer movable');
    expect(first.roomId).toBe('room-102');
  });

  test('undo restores a bulk auto-assignment', () => {
    const tournament = makeTestTournament();
    tournament.rooms = makeRooms(['101', '102']);
    const first = makeMatch(tournament, 1, testTeamNames[0], testTeamNames[1]);
    const second = makeMatch(tournament, 1, testTeamNames[2], testTeamNames[3]);
    tournament.scheduledMatches = [first, second];

    const plan = planAutoAssignUnassigned(tournament, [1]);
    const before = [first.roomId, second.roomId];
    const snapshot = captureRoomAssignmentSnapshot(
      tournament,
      plan.changes.map((change) => change.matchId),
    );
    applyRebalance(tournament, plan);

    expect(plan.changes).toHaveLength(2);
    expect([first.roomId, second.roomId]).not.toEqual(before);
    expect(restoreRoomAssignmentSnapshot(tournament, snapshot)).toEqual([]);
    expect([first.roomId, second.roomId]).toEqual(before);
  });

  test('undo restores a rebalance and its assignment provenance', () => {
    const tournament = makeTestTournament();
    tournament.rooms = makeRooms(['101', '102']);
    const first = makeMatch(tournament, 1, testTeamNames[0], testTeamNames[1], 'room-101');
    const second = makeMatch(tournament, 2, testTeamNames[2], testTeamNames[3], 'room-101');
    first.roomAssignmentSource = 'manual';
    second.roomAssignmentSource = 'manual';
    tournament.scheduledMatches = [first, second];

    const room = tournament.rooms[0];
    const snapshot = captureRoomAssignmentSnapshot(tournament, [first.id, second.id]);
    room.availableRoundNumbers = [1];
    const changedPlan = planRebalance(tournament, [1, 2]);

    expect(changedPlan.changes.some((change) => change.matchId === second.id)).toBe(true);
    applyRebalance(tournament, changedPlan);
    expect(second.roomId).toBe('room-102');
    room.availableRoundNumbers = [1, 2];
    expect(restoreRoomAssignmentSnapshot(tournament, snapshot)).toEqual([]);
    expect(first.roomId).toBe('room-101');
    expect(second.roomId).toBe('room-101');
    expect(second.roomAssignmentSource).toBe('manual');
  });

  test('applies a multi-way room cycle from final occupancy, not sequential occupancy', () => {
    const tournament = makeTestTournament();
    tournament.rooms = makeRooms(['101', '102', '103']);
    const first = makeMatch(tournament, 1, testTeamNames[0], testTeamNames[1], 'room-101');
    const second = makeMatch(tournament, 1, testTeamNames[2], testTeamNames[3], 'room-102');
    const third = makeMatch(tournament, 1, testTeamNames[0], testTeamNames[2], 'room-103');
    tournament.scheduledMatches = [first, second, third];

    const reviewed = planRebalance(tournament, [1]);
    const cyclePlan = {
      ...reviewed,
      issues: [],
      changes: [
        { matchId: first.id, fromRoomId: 'room-101', toRoomId: 'room-102' },
        { matchId: second.id, fromRoomId: 'room-102', toRoomId: 'room-103' },
        { matchId: third.id, fromRoomId: 'room-103', toRoomId: 'room-101' },
      ],
    };

    expect(applyRebalance(tournament, cyclePlan).ok).toBe(true);
    expect([first.roomId, second.roomId, third.roomId]).toEqual(['room-102', 'room-103', 'room-101']);
  });

  test('rejects a stale reviewed rebalance without changing assignments', () => {
    const tournament = makeTestTournament();
    tournament.rooms = makeRooms(['101', '102']);
    const first = makeMatch(tournament, 1, testTeamNames[0], testTeamNames[1], 'room-101');
    const second = makeMatch(tournament, 1, testTeamNames[2], testTeamNames[3]);
    tournament.scheduledMatches = [first, second];

    const plan = planRebalance(tournament, [1]);
    first.roomId = 'room-102';
    const before = tournament.scheduledMatches.map((match) => match.roomId);

    const result = applyRebalance(tournament, plan);

    expect(result.ok).toBe(false);
    expect(result.issues[0].message).toContain('stale');
    expect(tournament.scheduledMatches.map((match) => match.roomId)).toEqual(before);
  });

  test('rejects a partially invalid bulk plan without applying its valid changes', () => {
    const tournament = makeTestTournament();
    tournament.rooms = makeRooms(['101', '102', '103']);
    const first = makeMatch(tournament, 1, testTeamNames[0], testTeamNames[1]);
    const second = makeMatch(tournament, 1, testTeamNames[2], testTeamNames[3]);
    tournament.scheduledMatches = [first, second];

    const reviewed = planRebalance(tournament, [1]);
    expect(reviewed.changes).toHaveLength(2);
    const invalid = {
      ...reviewed,
      changes: [reviewed.changes[0], { ...reviewed.changes[1], toRoomId: 'missing-room' }],
    };
    const before = tournament.scheduledMatches.map((match) => match.roomId);

    expect(rebalancePlanHasBlockingIssues(invalid)).toBe(false);
    const applied = applyRebalance(tournament, invalid);

    expect(applied.ok).toBe(false);
    expect(applied.issues[0].message).toContain('target room');
    expect(tournament.scheduledMatches.map((match) => match.roomId)).toEqual(before);
  });
});
