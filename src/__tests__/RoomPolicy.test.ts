import { describe, expect, test } from 'vitest';
import { ScheduledMatch } from '../renderer/DataModel/ScheduledMatch';
import { TournamentRoom } from '../renderer/DataModel/TournamentRoom';
import { makeTestTournament, testTeamNames } from './TestFixtures';
import { resolveEligibleRooms } from '../renderer/Services/RoomAllocationService';

function makeRooms(names: string[]): TournamentRoom[] {
  return names.map((name, index) => new TournamentRoom(name, index, `room-${name}`));
}

function makeMatch(tournament: ReturnType<typeof makeTestTournament>, roundNumber = 1): ScheduledMatch {
  const phase = tournament.whichPhaseIsRoundNumberIn(roundNumber)!;
  const match = new ScheduledMatch(roundNumber, testTeamNames[0], testTeamNames[1]);
  match.phaseCode = phase.code;
  match.poolName = phase.pools[0]?.name;
  return match;
}

describe('room eligibility policy', () => {
  test('uses all enabled rooms when no policy is configured', () => {
    const tournament = makeTestTournament();
    tournament.rooms = makeRooms(['101', '102', '103']);
    tournament.rooms[1].enabled = false;

    const eligibility = resolveEligibleRooms(makeMatch(tournament), tournament);

    expect(eligibility.eligibleRooms.map((room) => room.name)).toEqual(['101', '103']);
    expect(eligibility.excludedRooms.find((item) => item.room.name === '102')?.reasons).toEqual(['disabled']);
  });

  test('intersects the stage room set with the round override', () => {
    const tournament = makeTestTournament();
    tournament.rooms = makeRooms(['101', '102', '103', '104']);
    const phase = tournament.phases[0];
    phase.roomIds = ['room-101', 'room-102', 'room-103'];
    phase.rounds[0].roomIds = ['room-102', 'room-103', 'room-104'];

    const eligibility = resolveEligibleRooms(makeMatch(tournament), tournament);

    expect(eligibility.eligibleRooms.map((room) => room.id)).toEqual(['room-102', 'room-103']);
    expect(eligibility.excludedRooms.find((item) => item.room.id === 'room-104')?.reasons).toEqual(['stage-policy']);
    expect(eligibility.excludedRooms.find((item) => item.room.id === 'room-101')?.reasons).toEqual(['round-override']);
  });

  test('intersects availability with stage and round policy', () => {
    const tournament = makeTestTournament();
    tournament.rooms = makeRooms(['101', '102', '103']);
    const phase = tournament.phases[0];
    phase.roomIds = ['room-101', 'room-102'];
    phase.rounds[0].roomIds = ['room-101', 'room-102'];
    tournament.rooms[0].availableRoundNumbers = [2, 3];

    const eligibility = resolveEligibleRooms(makeMatch(tournament), tournament);

    expect(eligibility.eligibleRooms.map((room) => room.id)).toEqual(['room-102']);
    expect(eligibility.excludedRooms.find((item) => item.room.id === 'room-101')?.reasons).toEqual(['unavailable']);
    expect(eligibility.excludedRooms.find((item) => item.room.id === 'room-103')?.reasons).toEqual([
      'stage-policy',
      'round-override',
    ]);
  });

  test('a locked pool preference narrows the eligible set', () => {
    const tournament = makeTestTournament();
    tournament.rooms = makeRooms(['101', '102', '103']);
    const pool = tournament.phases[0].pools[0];
    pool.preferredRoomIds = ['room-103'];
    pool.poolRoomsLocked = true;

    const eligibility = resolveEligibleRooms(makeMatch(tournament), tournament);

    expect(eligibility.eligibleRooms.map((room) => room.id)).toEqual(['room-103']);
    expect(eligibility.excludedRooms.find((item) => item.room.id === 'room-101')?.reasons).toEqual(['pool-policy']);
  });

  test('unknown policy ids are ignored, preserving the old all-enabled behavior', () => {
    const tournament = makeTestTournament();
    tournament.rooms = makeRooms(['101', '102']);
    tournament.phases[0].roomIds = ['room-deleted', 'room-101'];

    const eligibility = resolveEligibleRooms(makeMatch(tournament), tournament);

    expect(eligibility.eligibleRooms.map((room) => room.id)).toEqual(['room-101']);
  });
});
