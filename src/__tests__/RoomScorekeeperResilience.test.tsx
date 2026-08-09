/**
 * @vitest-environment jsdom
 */

/**
 * What a room Chromebook does when the tournament stops answering.
 *
 * The whole page is rendered — assignment polling, outbox, scorer and all — with the network under
 * the test's control, because the behaviour being checked is a *sequence*: score some questions,
 * take the server away, and see what is still on the screen. A unit test of any one piece would
 * have passed happily through the bug this file exists to prevent, which was that a 403 during a
 * game cleared the room's identity and navigated the page to the pairing form.
 *
 * The rule every test here restates: nothing arriving over the network takes a game off the screen.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AssignedRoomApp from '../room/AssignedRoomApp';
import { IRoomAssignmentResponse } from '../main/server/ServerTypes';
import { ScheduledMatchStatus } from '../renderer/DataModel/ScheduledMatch';
import scoringRulesToScorekeeperFormat from '../renderer/Services/ScorekeeperFormat';
import { CommonRuleSets, ScoringRules } from '../renderer/DataModel/ScoringRules';
import { readActiveGame, writeActiveGame } from '../room/ActiveGameRecord';
import { installDialogMethods, installLocalStorage } from './RoomScorerTestHarness';

const identity = { roomId: 'room-204', token: 'room-token', deviceId: 'device-1' };
const sessionId = 'session-1';
const sessionToken = 'session-token';

function formatFor() {
  const rules = new ScoringRules(CommonRuleSets.AcfPowers);
  rules.maximumPlayersPerTeam = 2;
  return scoringRulesToScorekeeperFormat(rules);
}

const scoringFormat = formatFor();

const matchup = {
  scheduledMatchId: 'sched-4',
  roundNumber: 4,
  roundName: 'Round 4',
  leftTeam: { name: 'Ninety Six', players: [{ name: 'Sarah Mitchell' }, { name: 'James Robinson' }] },
  rightTeam: { name: 'Greenwood', players: [{ name: 'Emma Turner' }, { name: 'Jordan Lee' }] },
  status: ScheduledMatchStatus.Playing,
};

function assignment(overrides: Partial<IRoomAssignmentResponse> = {}): IRoomAssignmentResponse {
  return {
    roomId: identity.roomId,
    roomName: 'Room 204',
    tournamentName: 'Ninety Six Invitational',
    current: matchup,
    previous: null,
    next: null,
    session: null,
    gameFormat: null,
    gameFormatErrors: [],
    gameFormatWarnings: [],
    scoringFormat,
    timedRounds: false,
    ...overrides,
  };
}

/**
 * A programmable stand-in for the room's whole HTTP surface.
 *
 * Deliberately routed by path rather than by call order: the page polls the assignment, presence
 * and the tournament on three different timers, and a queue of canned responses would encode the
 * order those happen to interleave in rather than the behaviour.
 */
interface INetwork {
  offline: boolean;
  assignmentStatus: number;
  assignmentBody: IRoomAssignmentResponse;
  tournamentKey: string;
  snapshots: object[];
  sessionRecovery: object | null;
}

let network: INetwork;
let fetchCalls: string[];
let replaced: string[];
let assigned: string[];
let storageHarness: ReturnType<typeof installLocalStorage>;

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function installFetch() {
  fetchCalls = [];
  vi.stubGlobal('fetch', async (path: string, init?: { method?: string; body?: string }) => {
    fetchCalls.push(`${init?.method ?? 'GET'} ${path}`);
    if (network.offline) throw new Error('Network request failed');

    if (path.includes('/assignment')) {
      if (network.assignmentStatus !== 200) {
        return jsonResponse(network.assignmentStatus, { error: 'This room link is not valid for this tournament.' });
      }
      return jsonResponse(200, { ...network.assignmentBody, tournamentKey: network.tournamentKey });
    }
    if (path.endsWith('/api/v1/tournament')) {
      return jsonResponse(200, {
        tournamentKey: network.tournamentKey,
        name: 'Ninety Six Invitational',
        gameFormat: null,
        gameFormatErrors: [],
        gameFormatWarnings: [],
        scoringFormat,
        timedRounds: false,
        roundCount: 1,
        teamCount: 2,
      });
    }
    if (path.endsWith('/api/v1/rounds')) return jsonResponse(200, { rounds: [{ number: 4, name: 'Round 4' }] });
    if (path.endsWith('/api/v1/teams')) {
      return jsonResponse(200, { teams: [matchup.leftTeam, matchup.rightTeam] });
    }
    if (path.includes('/presence')) {
      return jsonResponse(200, { presence: { roomId: identity.roomId, devices: [], readyDeviceCount: 0 } });
    }
    if (path.includes('/recovery')) {
      return jsonResponse(200, { sessionId, latestQbj: network.sessionRecovery, finalReceived: false });
    }
    if (path.includes('/snapshot')) {
      network.snapshots.push(JSON.parse(String(init?.body)));
      return jsonResponse(200, { sessionId });
    }
    if (path.includes('/sessions') && init?.method === 'POST') {
      return jsonResponse(200, { sessionId, token: sessionToken });
    }
    return jsonResponse(200, {});
  });
}

/** jsdom refuses real navigation; recording it is how "the page did not navigate" is asserted. */
function installLocation() {
  replaced = [];
  assigned = [];
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      pathname: `/room/${identity.roomId}`,
      search: '',
      hash: '',
      replace: (url: string) => replaced.push(url),
      assign: (url: string) => assigned.push(url),
    },
  });
}

beforeEach(() => {
  network = {
    offline: false,
    assignmentStatus: 200,
    assignmentBody: assignment(),
    tournamentKey: 'tourn-1',
    snapshots: [],
    sessionRecovery: null,
  };
  installFetch();
  installLocation();
  storageHarness = installLocalStorage();
  installDialogMethods();
  window.localStorage.setItem('yellowfruit.room.scorer.v1', JSON.stringify({ choice: 'first-party' }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Let the mounted page finish its first poll and settle. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Start the assigned game the way a scorekeeper does: mark ready, then press Start. */
async function startGame() {
  render(<AssignedRoomApp identity={identity} />);
  await waitFor(() => expect(screen.getByText('Ninety Six')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: 'Mark ready' }));
  await settle();
  const start = await screen.findByRole('button', { name: /^Start/ });
  await waitFor(() => expect(start.hasAttribute('disabled')).toBe(false));
  fireEvent.click(start);
  await waitFor(() => expect(screen.getByLabelText('Ninety Six score')).toBeTruthy());
}

function scoreOf(team: string): string {
  return screen.getByLabelText(`${team} score`).textContent ?? '';
}

function buzz(player: string, index: number) {
  const buttons = screen
    .getAllByRole('button')
    .filter((button) => button.getAttribute('aria-label')?.startsWith(player));
  fireEvent.click(buttons[index]);
}

describe('the server disappears mid-game', () => {
  test('the scorer stays on screen and keeps recording questions', async () => {
    await startGame();
    buzz('Sarah Mitchell', 1); // a conversion
    await waitFor(() => expect(screen.getByLabelText('Bonus')).toBeTruthy());
    fireEvent.click(screen.getByText('20'));
    expect(scoreOf('Ninety Six')).toBe('30');

    network.offline = true;
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });
    });

    // The game is still there, and still takes scoring.
    expect(screen.getByLabelText('Ninety Six score')).toBeTruthy();
    buzz('Emma Turner', 1);
    await waitFor(() => expect(scoreOf('Greenwood')).not.toBe('0'));
    expect(replaced).toEqual([]);
    expect(assigned).toEqual([]);
  });
});

describe('the room token stops being accepted', () => {
  test('a 403 during a game warns instead of clearing the room and navigating to /join', async () => {
    await startGame();
    buzz('Sarah Mitchell', 1);

    network.assignmentStatus = 403;
    await waitFor(() => expect(screen.queryByText(/Room connection changed/)).toBeTruthy(), { timeout: 8000 });

    // The one thing that must never happen.
    expect(replaced).toEqual([]);
    expect(screen.getByLabelText('Ninety Six score')).toBeTruthy();
    // A repair path, and a way to get the game off the device by hand.
    expect(screen.getByText('Repair connection')).toBeTruthy();
    expect(screen.getAllByText('Download QBJ backup').length).toBeGreaterThan(0);
    // No credential is ever put on screen.
    expect(document.body.textContent).not.toContain(sessionToken);
    expect(document.body.textContent).not.toContain(identity.token);
  }, 15000);

  test('with no game in progress, a 403 still sends the browser back to pairing', async () => {
    network.assignmentStatus = 403;
    render(<AssignedRoomApp identity={identity} />);

    await waitFor(() => expect(replaced).toEqual(['/join']));
  });
});

describe('a reload while the server is unreachable', () => {
  test('the game comes straight back from this device, with its score intact', async () => {
    await startGame();
    buzz('Sarah Mitchell', 1);
    await waitFor(() => expect(screen.getByLabelText('Bonus')).toBeTruthy());
    fireEvent.click(screen.getByText('20'));
    await waitFor(() => expect(scoreOf('Ninety Six')).toBe('30'));

    // The record that makes the saved game findable again was written when the game started.
    const record = readActiveGame({ roomId: identity.roomId });
    expect(record?.sessionId).toBe(sessionId);

    // Reload, with nothing answering.
    cleanup();
    network.offline = true;
    render(<AssignedRoomApp identity={identity} />);

    // No "Connecting…": the scoresheet, at the score it was left at.
    expect(screen.getByLabelText('Ninety Six score')).toBeTruthy();
    expect(scoreOf('Ninety Six')).toBe('30');
    expect(screen.queryByText(/Connecting to YellowFruit/)).toBeNull();
  });

  test('a record from a different room is not adopted', async () => {
    await startGame();
    cleanup();

    render(<AssignedRoomApp identity={{ ...identity, roomId: 'room-118' }} />);
    await settle();
    expect(screen.queryByLabelText('Ninety Six score')).toBeNull();
  });
});

describe('when the connection comes back', () => {
  test('the snapshot the server ends up with is the current game, not a replay of every click', async () => {
    await startGame();
    network.offline = true;
    buzz('Sarah Mitchell', 1);
    await waitFor(() => expect(screen.getByLabelText('Bonus')).toBeTruthy());
    fireEvent.click(screen.getByText('20'));

    const beforeReconnect = network.snapshots.length;
    network.offline = false;
    await waitFor(() => expect(network.snapshots.length).toBeGreaterThan(beforeReconnect), { timeout: 8000 });

    const latest = network.snapshots[network.snapshots.length - 1] as any;
    // Converged on the current state rather than catching up through a queue of stale ones.
    expect(latest.tossups_read).toBe(1);
  }, 15000);
});

describe('a browser that cannot save', () => {
  test('scoring still works, and the warning says the game is only on screen', async () => {
    await startGame();
    storageHarness.setFailWrites(true);
    buzz('Sarah Mitchell', 1);

    await waitFor(() => expect(screen.getByText(/Local save failed/)).toBeTruthy());
    expect(screen.getByText(/only on this screen/)).toBeTruthy();
    expect(screen.getAllByText('Download QBJ backup').length).toBeGreaterThan(0);
    // And it is still a working scoresheet.
    expect(screen.getByLabelText('Bonus')).toBeTruthy();
  });
});

describe('leaving the page', () => {
  test('an in-progress game asks before a refresh, and an idle room does not', async () => {
    render(<AssignedRoomApp identity={identity} />);
    await waitFor(() => expect(screen.getByText('Ninety Six')).toBeTruthy());

    const idle = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(idle);
    expect(idle.defaultPrevented).toBe(false);

    cleanup();
    await startGame();
    const playing = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(playing);
    expect(playing.defaultPrevented).toBe(true);
  });
});

describe('tournament control reassigns the room mid-game', () => {
  test('the game on screen is kept and the collision is explained', async () => {
    await startGame();
    buzz('Sarah Mitchell', 1);

    network.assignmentBody = assignment({
      current: { ...matchup, scheduledMatchId: 'sched-5', roundNumber: 5, roundName: 'Round 5' },
    });
    await waitFor(() => expect(screen.getByText(/different game/)).toBeTruthy(), { timeout: 8000 });

    expect(screen.getByLabelText('Ninety Six score')).toBeTruthy();
  }, 15000);
});

describe('the server comes back running a different tournament', () => {
  test('nothing is sent, and the room is told to hand the file over', async () => {
    await startGame();
    buzz('Sarah Mitchell', 1);
    const sentBefore = network.snapshots.length;

    network.tournamentKey = 'tourn-2';
    await waitFor(() => expect(screen.getByText(/different tournament/)).toBeTruthy(), { timeout: 8000 });

    // Whatever else happens, this game's progress is not filed against somebody else's event.
    buzz('Emma Turner', 1);
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 100);
      });
    });
    expect(network.snapshots.length).toBe(sentBefore);
    expect(screen.getByLabelText('Ninety Six score')).toBeTruthy();
  }, 15000);
});

describe('recovering from the server when the device has nothing', () => {
  test('a game with a local copy never consults the server for one', async () => {
    writeActiveGame({
      roomId: identity.roomId,
      tournamentKey: 'tourn-1',
      scheduledMatchId: matchup.scheduledMatchId,
      sessionId,
      sessionToken,
      tournamentName: 'Ninety Six Invitational',
      roomName: 'Room 204',
      roundNumber: 4,
      roundName: 'Round 4',
      matchup,
      scoringFormat,
      startedAt: new Date().toISOString(),
    });
    // A saved game for that session, as `GameSession` writes it.
    window.localStorage.setItem(
      `yellowfruit.room.game.v1.${sessionId}`,
      JSON.stringify({
        version: 1,
        gameKey: sessionId,
        setup: {
          left: { name: 'Ninety Six', players: ['Sarah Mitchell', 'James Robinson'] },
          right: { name: 'Greenwood', players: ['Emma Turner', 'Jordan Lee'] },
        },
        events: [
          {
            id: 'ev-1',
            type: 'tossup-buzz',
            questionNumber: 1,
            team: 'left',
            playerName: 'Sarah Mitchell',
            answerTypeIndex: 1,
          },
        ],
        updatedAt: new Date().toISOString(),
      }),
    );

    render(<AssignedRoomApp identity={identity} />);
    await settle();

    expect(screen.getByLabelText('Ninety Six score')).toBeTruthy();
    expect(fetchCalls.some((call) => call.includes('/recovery'))).toBe(false);
  });
});
