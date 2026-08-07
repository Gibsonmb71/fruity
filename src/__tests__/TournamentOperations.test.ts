import { afterEach, describe, expect, test, vi } from 'vitest';
import TournamentServerService from '../renderer/Services/TournamentServerService';
import { ScheduledMatch, ScheduledMatchStatus } from '../renderer/DataModel/ScheduledMatch';
import { TournamentRoom } from '../renderer/DataModel/TournamentRoom';
import { makeTestTournament, testTeamNames } from './TestFixtures';

const originalWindow = (global as any).window;

afterEach(() => {
  if (originalWindow === undefined) delete (global as any).window;
  else (global as any).window = originalWindow;
});

function scheduled(
  roundNumber: number,
  leftIndex: number,
  rightIndex: number,
  status = ScheduledMatchStatus.Scheduled,
) {
  const match = new ScheduledMatch(roundNumber, testTeamNames[leftIndex], testTeamNames[rightIndex]);
  match.status = status;
  return match;
}

describe('tournament operations release state', () => {
  test('the next release skips accepted history after a rebracket', () => {
    const tournament = makeTestTournament();
    tournament.scheduledMatches = [scheduled(1, 0, 1, ScheduledMatchStatus.Accepted), scheduled(8, 0, 2)];

    const service = new TournamentServerService(tournament);

    expect(service.nextRoundToRelease()).toBe(8);
  });

  test('releasing a round makes scheduled assignments ready without changing history', () => {
    const tournament = makeTestTournament();
    tournament.roomScoringMode = 'browser';
    const accepted = scheduled(1, 0, 1, ScheduledMatchStatus.Accepted);
    const future = scheduled(2, 0, 2);
    const room = new TournamentRoom('101', 0, 'room-101');
    future.roomId = room.id;
    tournament.rooms = [room];
    tournament.scheduledMatches = [accepted, future];
    const service = new TournamentServerService(tournament);
    let changes = 0;
    service.onScheduleChanged = () => {
      changes += 1;
    };

    expect(service.releaseRound(2)).toBe(true);
    expect(tournament.releasedRoundNumber).toBe(2);
    expect(future.status).toBe(ScheduledMatchStatus.Ready);
    expect(accepted.status).toBe(ScheduledMatchStatus.Accepted);
    expect(changes).toBe(1);
  });

  test('a started assignment moves from ready to playing', () => {
    const tournament = makeTestTournament();
    const future = scheduled(1, 0, 1, ScheduledMatchStatus.Ready);
    tournament.scheduledMatches = [future];
    const service = new TournamentServerService(tournament);

    service.handleSessionStarted(future.id);

    expect(future.status).toBe(ScheduledMatchStatus.Playing);
  });

  test('a failed running-server snapshot rolls back the release transaction', () => {
    const tournament = makeTestTournament();
    tournament.roomScoringMode = 'browser';
    const future = scheduled(1, 0, 1);
    const room = new TournamentRoom('101', 0, 'room-101');
    future.roomId = room.id;
    tournament.rooms = [room];
    tournament.scheduledMatches = [future];
    (global as any).window = {
      electron: {
        ipcRenderer: {
          sendMessage: vi.fn(() => {
            throw new Error('renderer IPC unavailable');
          }),
        },
      },
    };
    const service = new TournamentServerService(tournament);
    service.status = { running: true, port: 4732, addresses: [] } as any;

    expect(service.releaseRound(1)).toBe(false);
    expect(tournament.releasedRoundNumber).toBeNull();
    expect(future.status).toBe(ScheduledMatchStatus.Scheduled);
    expect(service.lastError).toContain('renderer IPC unavailable');
  });
});
