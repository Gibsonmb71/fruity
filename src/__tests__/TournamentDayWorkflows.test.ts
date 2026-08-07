import { describe, expect, test } from 'vitest';
import { checkCanStart } from '../main/server/RoomDirectory';
import HelpRequestStore from '../main/server/HelpRequestStore';
import PresenceStore from '../main/server/PresenceStore';
import {
  findRoomForPairing,
  genericPairingFailureMessage,
  listEnabledRooms,
  PairingAttemptLimiter,
} from '../main/server/RoomPairing';
import {
  IAssignmentDescriptor,
  IRoomDescriptor,
  ITournamentSnapshot,
  RoomBlockedReason,
  staleRoomThresholdMs,
} from '../main/server/ServerTypes';
import { ScheduledMatchStatus } from '../renderer/DataModel/ScheduledMatch';
import { formatPairingCode, normalizePairingCode, TournamentRoom } from '../renderer/DataModel/TournamentRoom';
import { ApplicationPages } from '../renderer/Enums';
import { getContextualAppPageHelpText, getHelpText, helpRegistry } from '../renderer/Components/PageLevelHelpText';

const room = (id: string, name: string, pairingCode: string, enabled = true): IRoomDescriptor => ({
  id,
  name,
  description: `${name} location`,
  accessToken: `secret-${id}`,
  pairingCode,
  enabled,
});

const assignment: IAssignmentDescriptor = {
  scheduledMatchId: 'scheduled-1',
  roomId: 'room-1',
  roundNumber: 1,
  roundName: '1',
  leftTeam: 'Alpha',
  rightTeam: 'Beta',
  status: ScheduledMatchStatus.Scheduled,
};

function snapshot(overrides: Partial<ITournamentSnapshot> = {}): ITournamentSnapshot {
  return {
    name: 'Tournament day',
    rounds: [{ number: 1, name: '1' }],
    teams: [],
    gameFormat: {} as ITournamentSnapshot['gameFormat'],
    gameFormatErrors: [],
    gameFormatWarnings: [],
    timedRounds: false,
    rooms: [room('room-1', 'Room 1', '12345678')],
    assignments: [assignment],
    currentRoundNumber: 1,
    ...overrides,
  };
}

describe('tournament-day pairing and presence primitives', () => {
  test('normalizes, formats, persists, and repairs pairing codes without changing access', () => {
    expect(normalizePairingCode('4827-1934')).toBe('48271934');
    expect(formatPairingCode('48271934')).toBe('4827 1934');

    const first = new TournamentRoom('Room 1', 0, 'room-1', 'keep-this-token', '4827 1934');
    const second = new TournamentRoom('Room 2', 1, 'room-2', 'keep-that-token', '48271934');
    const repaired = TournamentRoom.ensureUniquePairingCodes([first, second]);

    expect(repaired).toBe(1);
    expect(first.accessToken).toBe('keep-this-token');
    expect(second.accessToken).toBe('keep-that-token');
    expect(first.pairingCode).not.toBe(second.pairingCode);
    expect(first.toYftFileObject().pairingCode).toMatch(/^\d{8}$/);
    expect(TournamentRoom.fromYftFileObject(first.toYftFileObject())?.accessToken).toBe('keep-this-token');
  });

  test('retries pairing-code collisions and keeps public room lists credential-free', () => {
    let attempts = 0;
    const generated = TournamentRoom.generateUniquePairingCode(['12345678'], () => {
      attempts += 1;
      return attempts === 1 ? '12345678' : '87654321';
    });
    expect(generated).toBe('87654321');

    const current = snapshot({
      rooms: [room('room-1', 'Room 1', '12345678'), room('room-2', 'Room 2', '87654321', false)],
    });
    expect(listEnabledRooms(current)).toEqual([{ id: 'room-1', name: 'Room 1', description: 'Room 1 location' }]);
    expect(JSON.stringify(listEnabledRooms(current))).not.toContain('secret-room-1');
    expect(findRoomForPairing(current, '1234 5678')?.accessToken).toBe('secret-room-1');
    expect(findRoomForPairing(current, '1234-5678', 'room-2')).toBeNull();
    expect(genericPairingFailureMessage).toBe('That room code could not be verified.');
  });

  test('temporarily throttles repeated pairing failures', () => {
    let now = 0;
    const limiter = new PairingAttemptLimiter(2, 1000, 500, () => now);
    limiter.recordFailure('client');
    expect(limiter.isAllowed('client')).toBe(true);
    limiter.recordFailure('client');
    expect(limiter.isAllowed('client')).toBe(false);
    now = 500;
    expect(limiter.isAllowed('client')).toBe(true);
    limiter.recordSuccess('client');
    expect(limiter.isAllowed('client')).toBe(true);
  });

  test('tracks multiple devices and aggregates connected Ready state', () => {
    const store = new PresenceStore();
    const descriptor = room('room-1', 'Room 1', '12345678');
    store.checkIn(descriptor.id, 'device-a', 'Jordan', true, 0);
    store.checkIn(descriptor.id, 'device-b', 'Alex', false, 0);

    let presence = store.getRoom(descriptor, 0);
    expect(presence.connected).toBe(true);
    expect(presence.readyDeviceCount).toBe(1);
    expect(presence.devices).toHaveLength(2);
    expect(presence.devices?.find((device) => device.operatorName === 'Jordan')?.ready).toBe(true);

    presence = store.getRoom(descriptor, staleRoomThresholdMs + 1);
    expect(presence.connected).toBe(false);
    expect(presence.readyDeviceCount).toBe(0);
  });

  test('keeps help operational, one-active-per-device, contextual, and state-only', () => {
    const store = new HelpRequestStore();
    const descriptor = room('room-1', 'Room 1', '12345678');
    const request = store.create(
      descriptor,
      {
        category: 'team-missing',
        deviceId: 'device-a',
        operatorName: 'Jordan',
        message: 'Still at registration',
        currentMatchup: { roundNumber: 1, roundName: '1', leftTeam: 'Alpha', rightTeam: 'Beta' },
      },
      0,
    );
    expect(request).toMatchObject({ status: 'open', roomId: 'room-1', operatorName: 'Jordan' });
    expect(request?.currentMatchup?.leftTeam).toBe('Alpha');
    expect(store.create(descriptor, { category: 'wrong-room', deviceId: 'device-a' }, 1)?.id).toBe(request?.id);
    expect(store.create(descriptor, { category: 'wrong-room', deviceId: 'device-b' }, 1)?.id).not.toBe(request?.id);
    expect(store.updateState(request!.id, 'resolved', 'Runner notified', 2)?.status).toBe('resolved');
    expect(store.list('open')).toHaveLength(1);
  });

  test('Hold is an authoritative new-start block with a resumable path', () => {
    const descriptor = room('room-1', 'Room 1', '12345678');
    const held = snapshot({ holdNewRoomStarts: true, holdMessage: 'Waiting for a disputed result' });
    expect(checkCanStart(held, descriptor, assignment)).toEqual({
      reason: RoomBlockedReason.Hold,
      message: 'Waiting for a disputed result',
    });
    expect(checkCanStart(snapshot(), descriptor, assignment)).toBeNull();
  });
});

describe('typed contextual help registry', () => {
  test('has unique, non-empty topics and resolves each application context', () => {
    const topicIds = Object.keys(helpRegistry);
    expect(new Set(topicIds).size).toBe(topicIds.length);
    topicIds.forEach((topic) => {
      const sections = getHelpText(topic as keyof typeof helpRegistry);
      expect(sections.length).toBeGreaterThan(0);
      sections.forEach((section) => expect(section.content.length).toBeGreaterThan(0));
    });
    expect(getContextualAppPageHelpText(ApplicationPages.Setup, 'setup.rules').length).toBeGreaterThan(0);
    expect(getContextualAppPageHelpText(ApplicationPages.Control, 'control.rooms').length).toBeGreaterThan(0);
  });
});
