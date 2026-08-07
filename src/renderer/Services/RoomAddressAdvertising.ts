/**
 * Which address the room devices were told to use, and whether it is still the right one.
 *
 * A tournament LAN hands out addresses by DHCP, and the laptop running YellowFruit is not exempt.
 * The failure this file exists for is quiet and complete: the lease renews over lunch on a different
 * address, every printed room sheet and every QR code now points at nothing, and the first anyone
 * hears about it is four rooms saying their Chromebook has gone red. Nothing is broken — the server
 * is running, the tournament is fine — but the only piece of paper anyone has is wrong.
 *
 * The detection has to be about *identity*, not position. `os.networkInterfaces()` has no stable
 * order, a laptop with Wi-Fi, Ethernet and a VPN has three or four entries, and "the first one
 * changed" would fire every time a VPN connected. So the question asked here is the only one that
 * matters: is the address we actually gave the rooms still one of the addresses this machine has?
 */
import { INetworkAddress } from '../../main/server/ServerTypes';

/** The address room devices were last told to use. */
export interface IAdvertisedRoomAddress {
  /** Origin only, e.g. `http://172.18.128.20:4732`. */
  url: string;
  /** ISO 8601. Shown so a director can tell a lunchtime change from a this-morning one. */
  advertisedAt: string;
  /** The tournament it was advertised for; a different document must not inherit it. */
  tournamentKey?: string;
}

/** What the Control page shows when the advertised address has stopped being reachable. */
export interface IRoomAddressChange {
  previous: string;
  current: string;
  advertisedAt: string;
}

/**
 * Has the address we gave the rooms stopped being one of this machine's addresses?
 *
 * Returns null in every ambiguous case rather than warning. In particular: a server that is not
 * running has nothing to compare against, and a machine that reports no LAN addresses at all is
 * having a different problem — probably the Wi-Fi is off — which a "your address changed" banner
 * would misdescribe.
 */
export function detectRoomAddressChange(
  advertised: IAdvertisedRoomAddress | null,
  available: INetworkAddress[],
  currentSelection: string,
  options: { running: boolean; tournamentKey?: string } = { running: true },
): IRoomAddressChange | null {
  if (!advertised || !options.running) return null;
  if (advertised.tournamentKey !== undefined && advertised.tournamentKey !== options.tournamentKey) return null;
  if (available.length === 0) return null;

  // Membership, not position. A VPN adapter appearing ahead of the Wi-Fi one is not a change.
  if (available.some((address) => address.url === advertised.url)) return null;

  const current = currentSelection !== '' ? currentSelection : available[0].url;
  if (current === advertised.url) return null;
  return { previous: advertised.url, current, advertisedAt: advertised.advertisedAt };
}

/**
 * An optional friendlier address for room sheets, QR codes and room links.
 *
 * A director who has arranged a name for the scoring laptop — through the school's DNS, a hosts
 * file on a cart of Chromebooks, or an mDNS name the devices already resolve — can print that
 * instead of a DHCP address that may not survive lunch. YellowFruit provides no name resolution of
 * its own and makes no attempt to check that the name works: it is the director's arrangement, and
 * the numeric address stays visible beside it precisely so there is something to fall back to when
 * the arrangement turns out not to hold.
 *
 * @returns the normalized origin, or null if the input cannot be one.
 */
export function normalizePreferredRoomUrl(value: string, port: number): string | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;

  // A bare host or host:port is the common thing to type, so accept it and supply the scheme.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (parsed.hostname === '') return null;
  // A room URL is built by appending a path, so anything already carrying one would produce
  // nonsense like `http://host/rooms/room/room-1`.
  if ((parsed.pathname !== '' && parsed.pathname !== '/') || parsed.search !== '' || parsed.hash !== '') return null;
  if (parsed.username !== '' || parsed.password !== '') return null;

  const resolvedPort = parsed.port !== '' ? parsed.port : String(port);
  return `${parsed.protocol}//${parsed.hostname}:${resolvedPort}`;
}

/**
 * The origin room links, QR codes and setup sheets should use.
 *
 * The preferred URL wins when there is one, because that is the entire point of setting it. The
 * numeric address is what everything falls back to, and is shown alongside rather than replaced —
 * a name that does not resolve on the room devices has to be diagnosable from the printed sheet.
 */
export function resolveRoomLinkOrigin(preferredRoomUrl: string | null, numericAddress: string): string {
  return preferredRoomUrl && preferredRoomUrl !== '' ? preferredRoomUrl : numericAddress;
}
