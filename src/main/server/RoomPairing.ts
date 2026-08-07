/**
 * Human-friendly room pairing is intentionally separate from room authorization.
 *
 * A pairing code is only a short-lived way to discover the current room URL. It is not the room
 * credential itself: the long access token is returned only after a successful exchange and is
 * never included in the public room list or in an error response.
 */
import { normalizePairingCode } from '../../renderer/DataModel/TournamentRoom';
import { IRoomDescriptor, IRoomJoinDescriptor, IRoomJoinResponse, ITournamentSnapshot } from './ServerTypes';

export const genericPairingFailureMessage = 'That room code could not be verified.';

export function listEnabledRooms(snapshot: ITournamentSnapshot): IRoomJoinDescriptor[] {
  return snapshot.rooms
    .filter((room) => room.enabled)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .map((room) => ({ id: room.id, name: room.name, description: room.description }));
}

export function findRoomForPairing(
  snapshot: ITournamentSnapshot,
  code: unknown,
  roomId?: unknown,
): IRoomDescriptor | null {
  const normalized = normalizePairingCode(code);
  if (!normalized) return null;
  if (roomId !== undefined && (typeof roomId !== 'string' || roomId.trim() === '')) return null;
  return (
    snapshot.rooms.find(
      (room) => room.enabled && room.pairingCode === normalized && (roomId === undefined || room.id === roomId),
    ) ?? null
  );
}

export function toJoinResponse(room: IRoomDescriptor): IRoomJoinResponse {
  return {
    roomId: room.id,
    roomName: room.name,
    roomDescription: room.description,
    accessToken: room.accessToken,
  };
}

interface IRateLimitEntry {
  failures: number;
  windowStartedAt: number;
  blockedUntil: number;
}

/** Small in-memory limiter for bad code guesses; it disappears with the local server. */
export class PairingAttemptLimiter {
  private entries = new Map<string, IRateLimitEntry>();

  private readonly maxFailures: number;

  private readonly windowMs: number;

  private readonly cooldownMs: number;

  private readonly now: () => number;

  constructor(maxFailures = 5, windowMs = 30_000, cooldownMs = 30_000, now: () => number = () => Date.now()) {
    this.maxFailures = maxFailures;
    this.windowMs = windowMs;
    this.cooldownMs = cooldownMs;
    this.now = now;
  }

  isAllowed(source: string): boolean {
    const entry = this.entries.get(source);
    if (!entry) return true;
    const now = this.now();
    if (entry.blockedUntil > now) return false;
    if (now - entry.windowStartedAt >= this.windowMs) {
      this.entries.delete(source);
      return true;
    }
    return true;
  }

  recordFailure(source: string): void {
    const now = this.now();
    const previous = this.entries.get(source);
    const entry =
      !previous || now - previous.windowStartedAt >= this.windowMs
        ? { failures: 0, windowStartedAt: now, blockedUntil: 0 }
        : previous;
    entry.failures += 1;
    if (entry.failures >= this.maxFailures) entry.blockedUntil = now + this.cooldownMs;
    this.entries.set(source, entry);
  }

  recordSuccess(source: string): void {
    this.entries.delete(source);
  }

  clear(): void {
    this.entries.clear();
  }
}
