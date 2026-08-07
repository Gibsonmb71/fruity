import { afterEach, describe, expect, test, vi } from 'vitest';
import TournamentServerService from '../renderer/Services/TournamentServerService';
import { ISessionSummary, SessionDisplayState, SessionStatus, IServerStatus } from '../main/server/ServerTypes';
import { makeTestTournament } from './TestFixtures';

const originalWindow = (global as any).window;

afterEach(() => {
  if (originalWindow === undefined) delete (global as any).window;
  else (global as any).window = originalWindow;
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((_resolve, _reject) => {
    resolve = _resolve;
    reject = _reject;
  });
  return { promise, resolve, reject };
}

function sessionSummary(sessionId: string): ISessionSummary {
  const timestamp = new Date(0).toISOString();
  return {
    sessionId,
    roundNumber: 1,
    leftTeam: 'A',
    rightTeam: 'B',
    status: SessionStatus.Playing,
    displayState: SessionDisplayState.Live,
    createdAt: timestamp,
    lastSeenAt: timestamp,
    msSinceLastSeen: 0,
    score: null,
  };
}

describe('renderer server polling races', () => {
  test('an older sessions response cannot overwrite a newer response', async () => {
    const older = deferred<ISessionSummary[]>();
    const newer = deferred<ISessionSummary[]>();
    const invoke = vi
      .fn()
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise);
    (global as any).window = {
      electron: { ipcRenderer: { invoke, sendMessage: () => undefined } },
    };

    const service = new TournamentServerService(makeTestTournament());
    service.status = { running: true, port: 4732, addresses: [] } as IServerStatus;
    const firstRefresh = service.refreshSessions();
    const secondRefresh = service.refreshSessions();

    newer.resolve([sessionSummary('newer')]);
    await secondRefresh;
    older.resolve([sessionSummary('older')]);
    await firstRefresh;

    expect(service.sessions.map((session) => session.sessionId)).toEqual(['newer']);
  });

  test('an in-flight presence response cannot repopulate a replacement tournament', async () => {
    const older = deferred<Array<{ roomId: string; connected: boolean }>>();
    const invoke = vi.fn().mockImplementation(() => older.promise);
    (global as any).window = {
      electron: { ipcRenderer: { invoke, sendMessage: () => undefined } },
    };

    const service = new TournamentServerService(makeTestTournament());
    const refresh = service.refreshPresence();
    service.reset();
    older.resolve([{ roomId: 'old-room', connected: true }]);
    await refresh;

    expect(service.roomPresence).toEqual([]);
  });
});
