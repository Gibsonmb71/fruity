/**
 * How the room browser reads what it was told.
 *
 * These are the rules that decide whether a Chromebook says "Connected" or "Server unreachable",
 * and which of tournament control's verdicts is still worth showing. They are pure functions over
 * the response precisely so they can be pinned down here rather than only in a browser.
 */
import { describe, expect, test, vi } from 'vitest';
import {
  classifyPollResult,
  describeConnection,
  isAwaitingReview,
  offlineReassurance,
  reduceConnectionStatus,
  resolveLifecycleNotice,
  RoomConnectionState,
  shouldOfferPairing,
} from '../room/RoomLifecycle';
import { IRoomAssignmentResponse, RoomBlockedReason, SessionStatus } from '../main/server/ServerTypes';
import { ScheduledMatchStatus } from '../renderer/DataModel/ScheduledMatch';
import { ApiResult, getRoomAssignment } from '../room/api';

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
    scoringFormat: null,
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

  test('a non-JSON HTTP error is degraded rather than offline', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => '<!doctype html><title>Server Error</title>',
      }),
    );

    try {
      const result = await getRoomAssignment({ roomId: 'room-101', token: 'room-token' });

      expect(result).toEqual({
        ok: false,
        status: 500,
        error: 'The server sent a response the room app could not read.',
      });
      expect(classifyPollResult(result).connection).toBe(RoomConnectionState.Degraded);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test('bad credentials mean pair again, not offline', () => {
    const state = classifyPollResult({ ok: false, status: 403, error: 'This room link is not valid.' });

    expect(state.online).toBe(true);
    expect(state.needsPairing).toBe(true);
  });
});

/**
 * A room with a matchup on screen has something to be wrong about that a room still connecting does
 * not. These walk a page through a sequence of polls, because the property under test is not what one
 * response means on its own — it is what the room is showing after it.
 */
describe('a room that already has an assignment', () => {
  /** The state a room reaches by polling successfully once, which is what puts a matchup on screen. */
  function connectedRoom() {
    return reduceConnectionStatus({ ok: true, value: assignment() }, false);
  }

  test('a successful poll is Connected, with nothing to warn about', () => {
    const status = connectedRoom();

    expect(status.state).toBe(RoomConnectionState.Connected);
    expect(status.degradedMessage).toBe('');
    expect(status.loadError).toBe('');
  });

  test('a later server error degrades the room rather than taking it offline', () => {
    expect(connectedRoom().state).toBe(RoomConnectionState.Connected);
    const status = reduceConnectionStatus({ ok: false, status: 500, error: 'Unexpected error.' }, true);

    expect(status.state).toBe(RoomConnectionState.Degraded);
    expect(status.state).not.toBe(RoomConnectionState.Offline);
  });

  test('the degraded room says so where the scorekeeper can see it', () => {
    // The bug this exists for: the error was recorded, but the retained matchup went on rendering as
    // if it were current, so nothing about the failure ever reached the screen.
    const status = reduceConnectionStatus({ ok: false, status: 500, error: 'Unexpected error.' }, true);

    expect(status.degradedMessage).not.toBe('');
    // The matchup keeps its own place: a degraded room is not an error page.
    expect(status.loadError).toBe('');
  });

  test('the warning carries YellowFruit’s own explanation but never a status code', () => {
    const status = reduceConnectionStatus(
      { ok: false, status: 409, error: 'That round is on hold.', detail: 'That round is on hold.' },
      true,
    );

    expect(status.degradedMessage).toContain('That round is on hold.');
    expect(status.degradedMessage).not.toContain('409');
  });

  test('a refusal with no explanation of its own does not leak our fallback text', () => {
    const status = reduceConnectionStatus(
      { ok: false, status: 500, error: 'The server refused the request (500).' },
      true,
    );

    expect(status.degradedMessage).not.toContain('500');
  });

  test.each([400, 404, 409, 500])('HTTP %i is degraded, not offline', (httpStatus) => {
    const status = reduceConnectionStatus({ ok: false, status: httpStatus, error: 'Refused.' }, true);

    expect(status.state).toBe(RoomConnectionState.Degraded);
  });

  test('a request that never got an answer is Offline, with the offline messaging left alone', () => {
    const status = reduceConnectionStatus({ ok: false, error: 'Could not reach the YellowFruit computer.' }, true);

    expect(status.state).toBe(RoomConnectionState.Offline);
    // Offline already has its own retained-assignment banner; a second warning would just repeat it.
    expect(status.degradedMessage).toBe('');
  });

  test('the next successful poll clears the degradation by itself', () => {
    const degraded = reduceConnectionStatus({ ok: false, status: 500, error: 'Unexpected error.' }, true);
    expect(degraded.state).toBe(RoomConnectionState.Degraded);

    const recovered = reduceConnectionStatus({ ok: true, value: assignment() }, true);

    expect(recovered.state).toBe(RoomConnectionState.Connected);
    expect(recovered.degradedMessage).toBe('');
    expect(recovered.loadError).toBe('');
  });

  test('bad credentials ask for pairing rather than reporting a connection problem', () => {
    const status = reduceConnectionStatus({ ok: false, status: 403, error: 'This room link is not valid.' }, true);

    expect(status.needsPairing).toBe(true);
    expect(status.state).not.toBe(RoomConnectionState.Degraded);
    expect(status.state).not.toBe(RoomConnectionState.Offline);
  });
});

describe('a room with nothing on screen yet', () => {
  test('a failure before the first success is a load error, not a stale-data warning', () => {
    const status = reduceConnectionStatus({ ok: false, status: 500, error: 'Unexpected error.' }, false);

    expect(status.loadError).toBe('Unexpected error.');
    expect(status.degradedMessage).toBe('');
  });

  test('an unreachable server before the first success is still a load error', () => {
    const status = reduceConnectionStatus({ ok: false, error: 'Could not reach the YellowFruit computer.' }, false);

    expect(status.state).toBe(RoomConnectionState.Offline);
    expect(status.loadError).toBe('Could not reach the YellowFruit computer.');
  });
});

/**
 * Waiting on tournament control is what a working room does between finishing a game and being
 * handed the next one. It arrives as a perfectly ordinary 200, and must read as one.
 */
describe('tournament states are not connection states', () => {
  test('a submitted result leaves the room Connected', () => {
    const submitted = assignment({
      session: { sessionId: 's1', token: 't', status: SessionStatus.Submitted, finalReceived: true },
    });
    const status = reduceConnectionStatus({ ok: true, value: submitted }, true);

    expect(status.state).toBe(RoomConnectionState.Connected);
    expect(status.state).not.toBe(RoomConnectionState.Degraded);
    expect(status.state).not.toBe(RoomConnectionState.Offline);
    expect(isAwaitingReview(submitted)).toBe(true);
  });

  test.each([
    RoomBlockedReason.Submitted,
    RoomBlockedReason.Hold,
    RoomBlockedReason.FutureRound,
    RoomBlockedReason.NeedsAttention,
  ])('a room blocked for %s is still Connected', (reason) => {
    const status = reduceConnectionStatus({ ok: true, value: assignment({ blockedReason: reason }) }, true);

    expect(status.state).toBe(RoomConnectionState.Connected);
  });
});

describe('what the scorekeeper is told the connection is', () => {
  test('three plain states, and no status codes anywhere in them', () => {
    const labels = [RoomConnectionState.Connected, RoomConnectionState.Degraded, RoomConnectionState.Offline].map(
      describeConnection,
    );

    expect(labels).toEqual(['Connected', 'Connection issue', 'Offline']);
    for (const label of labels) expect(label).not.toMatch(/\d/);
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

describe('what an offline room is told will happen to the game', () => {
  test('a saved game on a room that can still send is told to keep scoring and wait', () => {
    expect(offlineReassurance(true, true)).toContain('will be sent when the connection comes back');
  });

  test('an emergency game is never told the connection will handle it', () => {
    // Emergency scoring has no session behind it, so nothing sends this result: it reaches the
    // tournament when a human carries the file. A scorekeeper who waits instead loses the game.
    const message = offlineReassurance(true, false);

    expect(message).not.toContain('will be sent when the connection comes back');
    expect(message).toContain('download the QBJ');
    expect(message).toContain('tournament control');
  });

  test('a browser that could not save the game says so before anything else', () => {
    expect(offlineReassurance(false, true)).toContain('cannot save the game locally');
    expect(offlineReassurance(false, false)).toContain('cannot save the game locally');
  });
});
