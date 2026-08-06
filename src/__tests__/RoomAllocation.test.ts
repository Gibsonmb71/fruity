import { describe, expect, test } from 'vitest';
import { ScheduledMatch, ScheduledMatchStatus } from '../renderer/DataModel/ScheduledMatch';
import { TournamentRoom } from '../renderer/DataModel/TournamentRoom';
import { makeTestTournament, testTeamNames } from './TestFixtures';
import { allocateRound, planRebalance, resolveEligibleRooms } from '../renderer/Services/RoomAllocationService';

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

function eligibilityMap(tournament: ReturnType<typeof makeTestTournament>, matches: ScheduledMatch[]) {
  return new Map(matches.map((match) => [match.id, resolveEligibleRooms(match, tournament)]));
}

describe('room allocation', () => {
  test('preserves current assignments before applying preferences or stickiness', () => {
    const tournament = makeTestTournament();
    tournament.rooms = makeRooms(['101', '102', '104']);
    const firstRound = makeMatch(tournament, 1, testTeamNames[0], testTeamNames[1], 'room-101');
    const nextRound = makeMatch(tournament, 2, testTeamNames[0], testTeamNames[2], 'room-104');
    const nextUnassigned = makeMatch(tournament, 2, testTeamNames[1], testTeamNames[3]);
    tournament.scheduledMatches = [firstRound, nextRound, nextUnassigned];

    const plan = planRebalance(tournament, [2]);

    expect(plan.moved).toEqual([]);
    expect(plan.newlyAssigned).toHaveLength(1);
    expect(plan.newlyAssigned[0]).toMatchObject({ matchId: nextUnassigned.id, toRoomId: 'room-101' });
    expect(plan.unchanged.find((change) => change.matchId === nextRound.id)).toMatchObject({
      fromRoomId: 'room-104',
      toRoomId: 'room-104',
    });
  });

  test('fills unassigned matches with the first free eligible room', () => {
    const tournament = makeTestTournament();
    tournament.rooms = makeRooms(['101', '102', '103']);
    const matches = [
      makeMatch(tournament, 1, testTeamNames[0], testTeamNames[1], 'room-101'),
      makeMatch(tournament, 1, testTeamNames[2], testTeamNames[3], 'room-102'),
      makeMatch(tournament, 1, 'Team E', 'Team F'),
    ];

    const allocation = allocateRound(matches, eligibilityMap(tournament, matches));

    expect(allocation.unassignable).toEqual([]);
    expect(allocation.assignments.find((assignment) => assignment.matchId === matches[2].id)).toMatchObject({
      roomId: 'room-103',
      kind: 'assigned',
    });
  });

  test('keeps a locked assignment and reports an ineligible locked room', () => {
    const tournament = makeTestTournament();
    tournament.rooms = makeRooms(['101', '102']);
    tournament.rooms[1].enabled = false;
    const locked = makeMatch(tournament, 1, testTeamNames[0], testTeamNames[1], 'room-102');
    locked.roomAssignmentLocked = true;
    const free = makeMatch(tournament, 1, testTeamNames[2], testTeamNames[3]);
    const matches = [locked, free];

    const allocation = allocateRound(matches, eligibilityMap(tournament, matches));

    expect(allocation.assignments.find((assignment) => assignment.matchId === locked.id)).toMatchObject({
      roomId: 'room-102',
      kind: 'locked',
    });
    expect(allocation.issues).toHaveLength(1);
    expect(allocation.issues[0].severity).toBe('error');
    expect(allocation.issues[0].scheduledMatchIds).toEqual([locked.id]);
    expect(allocation.assignments.find((assignment) => assignment.matchId === free.id)?.roomId).toBe('room-101');
  });

  test('does not reassign playing, submitted, or accepted matches', () => {
    const tournament = makeTestTournament();
    tournament.rooms = makeRooms(['101', '102', '103', '104']);
    const playing = makeMatch(tournament, 1, testTeamNames[0], testTeamNames[1], 'room-101');
    playing.status = ScheduledMatchStatus.Playing;
    const submitted = makeMatch(tournament, 1, testTeamNames[2], testTeamNames[3], 'room-102');
    submitted.status = ScheduledMatchStatus.Submitted;
    const accepted = makeMatch(tournament, 1, 'Team E', 'Team F', 'room-103');
    accepted.status = ScheduledMatchStatus.Accepted;
    const future = makeMatch(tournament, 1, 'Team G', 'Team H');
    tournament.scheduledMatches = [playing, submitted, accepted, future];

    const plan = planRebalance(tournament, [1]);

    expect(plan.moved).toEqual([]);
    expect(plan.newlyAssigned).toHaveLength(1);
    expect(plan.newlyAssigned[0].toRoomId).toBe('room-104');
    expect(plan.issues).toEqual([]);
  });

  test('uses a pool preference for a new assignment after preserving existing games', () => {
    const tournament = makeTestTournament();
    tournament.rooms = makeRooms(['101', '102', '103']);
    tournament.phases[0].pools[0].preferredRoomIds = ['room-103'];
    const match = makeMatch(tournament, 1, testTeamNames[0], testTeamNames[1]);
    tournament.scheduledMatches = [match];

    const plan = planRebalance(tournament, [1]);

    expect(plan.newlyAssigned[0]).toMatchObject({ matchId: match.id, toRoomId: 'room-103' });
  });

  test('is deterministic across repeated runs', () => {
    const tournament = makeTestTournament();
    tournament.rooms = makeRooms(['101', '102', '103']);
    const matches = [
      makeMatch(tournament, 1, testTeamNames[2], testTeamNames[3]),
      makeMatch(tournament, 1, testTeamNames[0], testTeamNames[1]),
    ];
    const eligible = eligibilityMap(tournament, matches);

    const first = allocateRound(matches, eligible);
    const second = allocateRound(matches, eligible);

    expect(second).toEqual(first);
  });
});
