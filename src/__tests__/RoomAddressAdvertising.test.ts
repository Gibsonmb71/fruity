/**
 * Noticing that the address on every printed room sheet has stopped being this computer's.
 *
 * The bug this guards against is not the DHCP change itself — nothing can prevent that — but the
 * two ways a naive check gets it wrong. Warning on interface *order* fires every time a VPN
 * connects, which trains a director to ignore the banner. Not warning at all means the first
 * anyone knows is four rooms going red at once with no explanation.
 */
import { describe, expect, test } from 'vitest';
import {
  detectRoomAddressChange,
  normalizePreferredRoomUrl,
  resolveRoomLinkOrigin,
} from '../renderer/Services/RoomAddressAdvertising';
import { INetworkAddress } from '../main/server/ServerTypes';

function address(ip: string, interfaceName = 'Wi-Fi'): INetworkAddress {
  return { interfaceName, address: ip, url: `http://${ip}:4732` };
}

const advertised = {
  url: 'http://172.18.128.20:4732',
  advertisedAt: '2026-08-07T08:00:00.000Z',
  tournamentKey: 'tourn-1',
};

const running = { running: true, tournamentKey: 'tourn-1' };

describe('detecting a changed address', () => {
  test('an address that is simply gone produces a warning naming both addresses', () => {
    const change = detectRoomAddressChange(
      advertised,
      [address('172.18.128.57')],
      'http://172.18.128.57:4732',
      running,
    );

    expect(change).toEqual({
      previous: 'http://172.18.128.20:4732',
      current: 'http://172.18.128.57:4732',
      advertisedAt: '2026-08-07T08:00:00.000Z',
    });
  });

  test('a new interface appearing ahead of the old one is not a change', () => {
    // A VPN or a virtual adapter connecting reorders os.networkInterfaces(). The advertised address
    // is still there, so nothing about the printed sheets is wrong.
    const change = detectRoomAddressChange(
      advertised,
      [address('10.8.0.3', 'VPN'), address('172.18.128.20')],
      'http://10.8.0.3:4732',
      running,
    );

    expect(change).toBeNull();
  });

  test('no warning while the server is not running', () => {
    expect(
      detectRoomAddressChange(advertised, [address('172.18.128.57')], 'http://172.18.128.57:4732', {
        running: false,
        tournamentKey: 'tourn-1',
      }),
    ).toBeNull();
  });

  test('no warning when this machine reports no addresses at all', () => {
    // Wi-Fi off is a different problem, and "your address changed" would misdescribe it.
    expect(detectRoomAddressChange(advertised, [], '', running)).toBeNull();
  });

  test('an address advertised for a different tournament is not inherited', () => {
    const change = detectRoomAddressChange(advertised, [address('172.18.128.57')], 'http://172.18.128.57:4732', {
      running: true,
      tournamentKey: 'tourn-2',
    });

    expect(change).toBeNull();
  });

  test('nothing advertised yet means nothing to compare', () => {
    expect(detectRoomAddressChange(null, [address('172.18.128.57')], 'http://172.18.128.57:4732', running)).toBeNull();
  });
});

describe('the optional preferred room address', () => {
  test('a bare hostname becomes an origin with the server port', () => {
    expect(normalizePreferredRoomUrl('yellowfruit.local', 4732)).toBe('http://yellowfruit.local:4732');
  });

  test('a full URL is accepted and its own port kept', () => {
    expect(normalizePreferredRoomUrl('http://yellowfruit.local:8080', 4732)).toBe('http://yellowfruit.local:8080');
    expect(normalizePreferredRoomUrl('https://scores.example.org', 4732)).toBe('https://scores.example.org:4732');
  });

  test('surrounding whitespace and a trailing slash are tolerated', () => {
    expect(normalizePreferredRoomUrl('  yellowfruit.local:4732/  ', 4732)).toBe('http://yellowfruit.local:4732');
  });

  test('anything that would break a room link is refused', () => {
    // Room URLs are built by appending a path, so a value that already has one produces nonsense.
    expect(normalizePreferredRoomUrl('http://host/rooms', 4732)).toBeNull();
    expect(normalizePreferredRoomUrl('http://host?x=1', 4732)).toBeNull();
    expect(normalizePreferredRoomUrl('ftp://host', 4732)).toBeNull();
    expect(normalizePreferredRoomUrl('http://user:pass@host', 4732)).toBeNull();
    expect(normalizePreferredRoomUrl('', 4732)).toBeNull();
    expect(normalizePreferredRoomUrl('http://', 4732)).toBeNull();
  });
});

describe('which origin room links use', () => {
  test('the preferred address wins when there is one', () => {
    expect(resolveRoomLinkOrigin('http://yellowfruit.local:4732', 'http://172.18.128.20:4732')).toBe(
      'http://yellowfruit.local:4732',
    );
  });

  test('the numeric address is what everything falls back to', () => {
    expect(resolveRoomLinkOrigin(null, 'http://172.18.128.20:4732')).toBe('http://172.18.128.20:4732');
    expect(resolveRoomLinkOrigin('', 'http://172.18.128.20:4732')).toBe('http://172.18.128.20:4732');
  });
});
