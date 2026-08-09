/**
 * The desktop finding a server that outlived it.
 *
 * The renderer always starts on a blank tournament with its own random operationalId, so after a
 * reload — a crash relaunch, the dev Reload item, a webpack rebuild — every status message from the
 * still-running main-process server names a tournament this window has not opened. The renderer
 * discards those messages, correctly: adopting another tournament's port, addresses and sessions is
 * exactly the isolation failure the key check exists to prevent.
 *
 * What it must not do is then render "Stopped". A director looking at a stopped server does the
 * obvious thing and starts it, or restarts the app, while every room in the building is happily
 * scoring against the server that never went anywhere.
 *
 * So: keep it, say it, and reattach when the matching file is opened. A genuinely different
 * tournament never matches and therefore never inherits anything.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';
import TournamentServerService from '../renderer/Services/TournamentServerService';
import { IServerStatus, ISessionSummary, SessionDisplayState, SessionStatus } from '../main/server/ServerTypes';
import Tournament from '../renderer/DataModel/Tournament';
import { IpcBidirectional, IpcMainToRend } from '../IPCChannels';
import { makeTestTournament } from './TestFixtures';

type IpcHandler = (payload: unknown) => void;

let listeners: Map<string, IpcHandler>;
let invoke: ReturnType<typeof vi.fn>;
let invokeResults: Map<string, unknown>;

function installElectron() {
  listeners = new Map();
  invokeResults = new Map();
  invoke = vi.fn(async (channel: string) => invokeResults.get(channel) ?? null);
  (global as any).window = {
    electron: {
      ipcRenderer: {
        invoke,
        sendMessage: () => undefined,
        on: (channel: string, handler: IpcHandler) => listeners.set(channel, handler),
      },
    },
  };
}

function statusFor(tournamentKey: string | undefined, running: boolean): IServerStatus {
  return { running, port: 4732, addresses: ['http://192.168.1.9:4732'], networkAddresses: [], tournamentKey };
}

function sessionFor(tournamentKey: string): ISessionSummary {
  const timestamp = new Date().toISOString();
  return {
    sessionId: 'session-live',
    roundNumber: 4,
    leftTeam: 'Ninety Six',
    rightTeam: 'Greenwood',
    status: SessionStatus.Playing,
    displayState: SessionDisplayState.Live,
    createdAt: timestamp,
    lastSeenAt: timestamp,
    msSinceLastSeen: 0,
    score: null,
    tournamentKey,
  };
}

/** A service on a blank document, exactly as a freshly reloaded renderer starts. */
function blankRenderer(): TournamentServerService {
  const service = new TournamentServerService(new Tournament());
  service.dataChangedReactCallback = () => undefined;
  service.addIpcListeners();
  return service;
}

beforeEach(() => {
  installElectron();
});

describe('a renderer that restarted underneath a running server', () => {
  test('it reports the surviving server honestly instead of claiming Stopped', () => {
    const service = blankRenderer();

    listeners.get(IpcMainToRend.TournamentServerStatusChanged)?.(statusFor('tourn-live', true));

    // Not adopted: this window has no business showing another tournament's port or addresses.
    expect(service.status.running).toBe(false);
    // But not silently discarded either.
    expect(service.survivingServer?.running).toBe(true);
    expect(service.survivingServerNotice).toContain('still running');
    expect(service.survivingServerNotice).toContain('Reopen the tournament file');
  });

  test('the blank startup tournament never inherits the live server’s sessions', () => {
    const service = blankRenderer();
    listeners.get(IpcMainToRend.TournamentServerStatusChanged)?.(statusFor('tourn-live', true));

    listeners.get(IpcMainToRend.TournamentServerSessionsChanged)?.([sessionFor('tourn-live')]);

    expect(service.sessions).toEqual([]);
  });

  test('a surviving server that is genuinely stopped says nothing at all', () => {
    const service = blankRenderer();

    listeners.get(IpcMainToRend.TournamentServerStatusChanged)?.(statusFor('tourn-live', false));

    expect(service.survivingServer).toBeNull();
    expect(service.survivingServerNotice).toBe('');
  });
});

describe('opening the tournament the server is serving', () => {
  test('the matching operationalId reattaches, and sessions come back', async () => {
    const service = blankRenderer();
    listeners.get(IpcMainToRend.TournamentServerStatusChanged)?.(statusFor('tourn-live', true));
    expect(service.status.running).toBe(false);

    // Reopening the .yft restores its operationalId, which is the server's recovery key.
    const reopened = makeTestTournament();
    reopened.operationalId = 'tourn-live';
    invokeResults.set(IpcBidirectional.TournamentServerGetStatus, statusFor('tourn-live', true));
    invokeResults.set(IpcBidirectional.TournamentServerGetSessions, [sessionFor('tourn-live')]);
    invokeResults.set(IpcBidirectional.TournamentServerGetPendingSubmissions, []);
    invokeResults.set(IpcBidirectional.TournamentServerGetRoomPresence, []);
    invokeResults.set(IpcBidirectional.TournamentServerGetHelpRequests, []);

    service.setTournament(reopened);

    expect(service.status.running).toBe(true);
    expect(service.survivingServer).toBeNull();
    expect(service.survivingServerNotice).toBe('');

    // The refreshes the reattach kicks off are asynchronous; the live rooms come back with them.
    await vi.waitFor(() => expect(service.sessions.map((session) => session.sessionId)).toEqual(['session-live']));
  });

  test('a genuinely different tournament does not reattach and does not inherit anything', () => {
    const service = blankRenderer();
    listeners.get(IpcMainToRend.TournamentServerStatusChanged)?.(statusFor('tourn-live', true));

    const different = makeTestTournament();
    different.operationalId = 'tourn-somewhere-else';
    service.setTournament(different);

    expect(service.status.running).toBe(false);
    expect(service.sessions).toEqual([]);
    // Still up, still not ours: the notice stays, because reopening the right file is still the fix.
    expect(service.survivingServer?.running).toBe(true);
  });
});

describe('polling', () => {
  test('a foreign running status is recorded without reading that tournament’s data', async () => {
    const service = blankRenderer();
    invokeResults.set(IpcBidirectional.TournamentServerGetStatus, statusFor('tourn-live', true));
    invokeResults.set(IpcBidirectional.TournamentServerGetPendingSubmissions, [
      { sessionId: 'x', tournamentKey: 'tourn-live' },
    ]);

    await service.refreshStatus();

    expect(service.status.running).toBe(false);
    expect(service.survivingServer?.running).toBe(true);
    expect(service.inbox).toEqual([]);
    // Nothing beyond the status was asked for.
    expect(invoke.mock.calls.map((call) => call[0])).toEqual([IpcBidirectional.TournamentServerGetStatus]);
  });

  test('a status for this tournament is adopted as usual', async () => {
    const open = makeTestTournament();
    const service = new TournamentServerService(open);
    service.dataChangedReactCallback = () => undefined;
    service.addIpcListeners();
    const key = open.operationalId;
    invokeResults.set(IpcBidirectional.TournamentServerGetStatus, statusFor(key, true));
    invokeResults.set(IpcBidirectional.TournamentServerGetPendingSubmissions, []);
    invokeResults.set(IpcBidirectional.TournamentServerGetRoomPresence, []);
    invokeResults.set(IpcBidirectional.TournamentServerGetHelpRequests, []);

    await service.refreshStatus();

    expect(service.status.running).toBe(true);
    expect(service.survivingServer).toBeNull();
  });
});
