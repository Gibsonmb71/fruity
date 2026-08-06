import { describe, expect, test } from 'vitest';
import { ScheduledMatch, ScheduledMatchStatus } from '../renderer/DataModel/ScheduledMatch';
import { TournamentRoom } from '../renderer/DataModel/TournamentRoom';
import { applyRebalance, planRoomDisable } from '../renderer/Services/RoomAllocationService';
import { makeTestTournament, testTeamNames } from './TestFixtures';

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

describe('room disable planning', () => {
  test('leave-unassigned preserves accepted history and identifies future games', () => {
    const tournament = makeTestTournament();
    tournament.rooms = makeRooms(['101', '102']);
    const accepted = makeMatch(tournament, 1, testTeamNames[0], testTeamNames[1], 'room-101');
    accepted.status = ScheduledMatchStatus.Accepted;
    accepted.roomNameAtPlay = '101';
    const future = makeMatch(tournament, 2, testTeamNames[2], testTeamNames[3], 'room-101');
    tournament.scheduledMatches = [accepted, future];

    const plan = planRoomDisable(tournament, 'room-101', 'leave-unassigned');

    expect(plan.changes).toEqual([
      { matchId: future.id, fromRoomId: 'room-101', reason: 'room disabled; left unassigned' },
    ]);
    expect(plan.unableToAssign[0].matchId).toBe(future.id);
    expect(accepted.roomId).toBe('room-101');

    applyRebalance(tournament, plan);

    expect(tournament.rooms[0].enabled).toBe(false);
    expect(accepted.roomId).toBe('room-101');
    expect(accepted.roomNameAtPlay).toBe('101');
    expect(future.roomId).toBeUndefined();
  });

  test('redistribute previews a free replacement room', () => {
    const tournament = makeTestTournament();
    tournament.rooms = makeRooms(['101', '102']);
    const future = makeMatch(tournament, 1, testTeamNames[0], testTeamNames[1], 'room-101');
    tournament.scheduledMatches = [future];

    const plan = planRoomDisable(tournament, 'room-101', 'redistribute');

    expect(plan.changes).toEqual([
      { matchId: future.id, fromRoomId: 'room-101', toRoomId: 'room-102', reason: 'automatic allocation' },
    ]);

    applyRebalance(tournament, plan);

    expect(tournament.rooms[0].enabled).toBe(false);
    expect(future.roomId).toBe('room-102');
    expect(future.roomAssignmentSource).toBe('auto');
  });
});
