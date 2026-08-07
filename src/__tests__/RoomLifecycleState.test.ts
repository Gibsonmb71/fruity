/**
 * How the room browser reads what it was told.
 *
 * These are the rules that decide whether a Chromebook says "Connected" or "Server unreachable",
 * and which of tournament control's verdicts is still worth showing. They are pure functions over
 * the response precisely so they can be pinned down here rather than only in a browser.
 */
import { describe, expect, test } from 'vitest';
import {
  classifyPollResult,
  isAwaitingReview,
  resolveLifecycleNotice,
  shouldOfferPairing,
} from '../room/RoomLifecycle';
import { IRoomAssignmentResponse, RoomBlockedReason, SessionStatus } from '../main/server/ServerTypes';
import { ScheduledMatchStatus } from '../renderer/DataModel/ScheduledMatch';
import { ApiResult } from '../room/api';

function assignment(overrides: Partial<IRoomAssignmentResponse> = {}): IRoomAssignmentResponse {
  return {
    roomId: 'room-101',
    roomName: 'Room 101',
    tournamentName: 'Ninety Six Invitational',
    current: {
      scheduledMatchId: 'sched-a',
      roundNumber: 4,
      roundName: '4',
      leftTeam: { name: 'Ninety Six A', players: [] },
      rightTeam: { name: 'Greenwood A', players: [] },
      status: ScheduledMatchStatus.Scheduled,
    },
    previous: null,
    next: null,
    session: null,
    gameFormat: null,
    gameFormatErrors: [],
    gameFormatWarnings: [],
    timedRounds: false,
    ...overrides,
  };
}

function currentMatch(scheduledMatchId: string) {
  return { ...assignment().current!, scheduledMatchId };
}

describe('connection state', () => {
  test('a successful response is online', () => {
    const state = classifyPollResult({ ok: true, value: {} } as ApiResult<unknown>);

    expect(state.online).toBe(true);
    expect(state.needsPairing).toBe(false);
  });

  test('a request that never got an answer is offline', () => {
    const state = classifyPollResult({ ok: false, error: 'Could not reach the YellowFruit computer.' });

    expect(state.online).toBe(false);
    expect(state.needsPairing).toBe(false);
  });

  test('a lifecycle refusal from a reachable server is still online', () => {
    // The exact status matters less than the fact that there was one: the server answered.
    const state = classifyPollResult({ ok: false, status: 409, error: 'A final is awaiting review.' });

    expect(state.online).toBe(true);
    expect(state.needsPairing).toBe(false);
  });

  test('a server error is online, because the server is plainly there', () => {
    const state = classifyPollResult({ ok: false, status: 500, error: 'Unexpected error.' });

    expect(state.online).toBe(true);
  });

  test('bad credentials mean pair again, not offline', () => {
    const state = classifyPollResult({ ok: false, status: 403, error: 'This room link is not valid.' });

    expect(state.online).toBe(true);
    expect(state.needsPairing).toBe(true);
  });
});

describe('what the bare server address opens', () => {
  const rooms = [{ id: 'room-101', name: 'Room 101' }];

  test('pairing, when browser room scoring is actually being used', () => {
    expect(shouldOfferPairing({ ok: true, value: { rooms, roomScoringMode: 'browser' } })).toBe(true);
  });

  test('manual scoring for a traditional tournament, even when rooms happen to exist', () => {
    expect(shouldOfferPairing({ ok: true, value: { rooms, roomScoringMode: 'traditional' } })).toBe(false);
  });

  test('manual scoring when browser scoring is on but no room has been configured to pair with', () => {
    expect(shouldOfferPairing({ ok: true, value: { rooms: [], roomScoringMode: 'browser' } })).toBe(false);
  });

  test('manual scoring when the server could not say, since manual needs nothing from it', () => {
    expect(shouldOfferPairing({ ok: false, error: 'Could not reach the YellowFruit computer.' })).toBe(false);
  });
});

describe('awaiting review', () => {
  test('a submitted session is awaiting review', () => {
    const value = assignment({
      session: { sessionId: 's1', token: 't', status: SessionStatus.Submitted, finalReceived: true },
    });

    expect(isAwaitingReview(value)).toBe(true);
  });

  test('the blocked reason alone is enough, for a page that has not resumed a session', () => {
    expect(isAwaitingReview(assignment({ blockedReason: RoomBlockedReason.Submitted }))).toBe(true);
  });

  test('a game in progress is not awaiting review', () => {
    const value = assignment({
      session: { sessionId: 's1', token: 't', status: SessionStatus.Playing, finalReceived: false },
    });

    expect(isAwaitingReview(value)).toBe(false);
  });

  test('a room on hold is blocked but not awaiting review', () => {
    expect(isAwaitingReview(assignment({ blockedReason: RoomBlockedReason.Hold }))).toBe(false);
  });

  test('nothing loaded yet is not awaiting review', () => {
    expect(isAwaitingReview(null)).toBe(false);
  });
});

describe('lifecycle notices belong to a game', () => {
  test('a rejection about the current game is shown, with the reason', () => {
    const notice = resolveLifecycleNotice(
      assignment({
        lastOutcome: {
          scheduledMatchId: 'sched-a',
          status: SessionStatus.Rejected,
          rejectionReason: 'Player TUH does not match the team total.',
        },
      }),
    );

    expect(notice?.scheduledMatchId).toBe('sched-a');
    expect(notice?.status).toBe(SessionStatus.Rejected);
    expect(notice?.text).toContain('needs correction');
    expect(notice?.text).toContain('Player TUH does not match the team total.');
  });

  test('a rejection does not follow the room onto the next game', () => {
    const notice = resolveLifecycleNotice(
      assignment({
        current: currentMatch('sched-b'),
        lastOutcome: { scheduledMatchId: 'sched-a', status: SessionStatus.Rejected, rejectionReason: 'Wrong teams' },
      }),
    );

    expect(notice).toBeNull();
  });

  test('a rejection clears once the correction has been resubmitted', () => {
    const notice = resolveLifecycleNotice(
      assignment({
        lastOutcome: { scheduledMatchId: 'sched-a', status: SessionStatus.Rejected, rejectionReason: 'Wrong teams' },
        session: { sessionId: 's2', token: 't', status: SessionStatus.Submitted, finalReceived: true },
      }),
    );

    expect(notice).toBeNull();
  });

  test('an acceptance is shown while the room is waiting for its next game', () => {
    const notice = resolveLifecycleNotice(
      assignment({ current: null, lastOutcome: { scheduledMatchId: 'sched-a', status: SessionStatus.Accepted } }),
    );

    expect(notice?.status).toBe(SessionStatus.Accepted);
    expect(notice?.text).toContain('Waiting for the next assignment');
  });

  test('an acceptance stops being shown once the next game arrives', () => {
    const notice = resolveLifecycleNotice(
      assignment({
        current: currentMatch('sched-b'),
        lastOutcome: { scheduledMatchId: 'sched-a', status: SessionStatus.Accepted },
      }),
    );

    expect(notice).toBeNull();
  });

  test('no outcome means no notice', () => {
    expect(resolveLifecycleNotice(assignment())).toBeNull();
    expect(resolveLifecycleNotice(null)).toBeNull();
  });
});
