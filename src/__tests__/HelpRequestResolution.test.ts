/**
 * Resolving a room's help request is a tournament-day action with a person on the other end of it.
 *
 * If it fails and nobody says so, the request disappears from the director's attention list while
 * the room goes on waiting for someone to come and see them. So: nothing is removed from the queue
 * until the server confirms it, and every failure path leaves a specific message behind for the UI
 * to show.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import TournamentServerService from '../renderer/Services/TournamentServerService';
import { IHelpRequest } from '../main/server/ServerTypes';
import { makeTestTournament } from './TestFixtures';

const originalWindow = (global as any).window;

afterEach(() => {
  if (originalWindow === undefined) delete (global as any).window;
  else (global as any).window = originalWindow;
});

function openRequest(overrides: Partial<IHelpRequest> = {}): IHelpRequest {
  const timestamp = new Date(0).toISOString();
  return {
    id: 'help-1',
    roomId: 'room-101',
    roomName: 'Room 101',
    category: 'scoring-problem',
    message: 'Bonus total does not add up',
    status: 'open',
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

/** A service holding one open help request, with a stubbed IPC bridge. */
function serviceWithOpenRequest(invoke: (...args: unknown[]) => unknown) {
  (global as any).window = { electron: { ipcRenderer: { invoke, sendMessage: () => undefined } } };
  const service = new TournamentServerService(makeTestTournament());
  service.helpRequests = [openRequest()];
  return service;
}

/** What Control shows: the requests still needing someone to go and look. */
function activeRequests(service: TournamentServerService): IHelpRequest[] {
  return service.helpRequests.filter((request) => request.status === 'open');
}

describe('resolving succeeds', () => {
  test('the request leaves the active list', async () => {
    const service = serviceWithOpenRequest(async () => openRequest({ status: 'resolved' }));

    const updated = await service.updateHelpRequest('help-1', 'resolved');

    expect(updated?.status).toBe('resolved');
    expect(activeRequests(service)).toHaveLength(0);
  });

  test('a previous failure message is cleared, so the next failure is not mistaken for it', async () => {
    const service = serviceWithOpenRequest(async () => openRequest({ status: 'resolved' }));
    service.lastError = 'something older';

    await service.updateHelpRequest('help-1', 'resolved');

    expect(service.lastError).toBe('');
  });
});

describe('resolving fails', () => {
  test('a refusal from the server leaves the request open and reports why', async () => {
    const service = serviceWithOpenRequest(async () => null);

    const updated = await service.updateHelpRequest('help-1', 'resolved');

    expect(updated).toBeNull();
    expect(activeRequests(service)).toHaveLength(1);
    expect(service.lastError).not.toBe('');
  });

  test('a thrown IPC error leaves the request open and reports why', async () => {
    const service = serviceWithOpenRequest(async () => {
      throw new Error('The tournament server is not running.');
    });

    const updated = await service.updateHelpRequest('help-1', 'resolved');

    expect(updated).toBeNull();
    expect(activeRequests(service)).toHaveLength(1);
    expect(service.lastError).toContain('not running');
  });

  test('the failure is announced to the UI rather than being silently absorbed', async () => {
    const service = serviceWithOpenRequest(async () => null);
    const onDataChanged = vi.fn();
    service.dataChangedReactCallback = onDataChanged;

    await service.updateHelpRequest('help-1', 'resolved');

    expect(onDataChanged).toHaveBeenCalled();
  });

  test('a retry after a failure still works, so the director is not stuck', async () => {
    let attempts = 0;
    const service = serviceWithOpenRequest(async () => {
      attempts += 1;
      return attempts === 1 ? null : openRequest({ status: 'resolved' });
    });

    await service.updateHelpRequest('help-1', 'resolved');
    expect(activeRequests(service)).toHaveLength(1);

    const retry = await service.updateHelpRequest('help-1', 'resolved');

    expect(retry?.status).toBe('resolved');
    expect(activeRequests(service)).toHaveLength(0);
  });

  test('with no bridge at all the request stays open and says so', async () => {
    delete (global as any).window;
    const service = new TournamentServerService(makeTestTournament());
    service.helpRequests = [openRequest()];

    const updated = await service.updateHelpRequest('help-1', 'resolved');

    expect(updated).toBeNull();
    expect(activeRequests(service)).toHaveLength(1);
    expect(service.lastError).not.toBe('');
  });
});
