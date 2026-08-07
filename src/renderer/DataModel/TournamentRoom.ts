/**
 * A physical playing location at the tournament: "Room 101", "Library", "Cafeteria Left".
 *
 * Rooms are YellowFruit's own concept, not part of the QBJ schema, so they live in the .yft file's
 * YfData and are omitted from QBJ export. They are deliberately durable: a room's id and access
 * token are what make its URL permanent, so the Chromebook in room 101 can stay on one page all day
 * and simply be told what to score next.
 *
 * Only stable configuration belongs here. Whether a room is currently connected, what it's playing
 * right now, and how far into a game it is are all server-side session state that changes by the
 * second and must never be written to the tournament file.
 */
import { randomHex, randomId } from '../Utils/RandomIds';

/** A room as written to a .yft file */
export interface IYftFileRoom {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  accessToken: string;
  /** Human-friendly pairing code. Optional only for files written before browser pairing existed. */
  pairingCode?: string;
  sortOrder: number;
  availableRoundNumbers?: number[];
}

/** Bytes of entropy in a room access token */
const tokenBytes = 24;
export const pairingCodeLength = 8;

/** Normalize the three human-friendly forms accepted by the join screen. */
export function normalizePairingCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const compact = value.replace(/[\s-]/g, '');
  return /^\d{8}$/.test(compact) ? compact : null;
}

/** Display an 8-digit code in the form people read over the phone or from a room sheet. */
export function formatPairingCode(value: string): string {
  const normalized = normalizePairingCode(value);
  if (!normalized) return value;
  return `${normalized.slice(0, 4)} ${normalized.slice(4)}`;
}

/** Generate a leading-zero-safe, cryptographically random 8-digit code. */
function generateRandomPairingCode(): string {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(bytes[0] % 100_000_000).padStart(pairingCodeLength, '0');
}

export class TournamentRoom {
  /** Stable identifier. Appears in the room's URL and never changes once the room exists. */
  id: string;

  name: string = '';

  description: string = '';

  /**
   * A disabled room keeps its history and its URL but is not given new assignments. This is how a
   * room that turns out to be unusable on the day gets taken out of rotation without losing the
   * games already played in it.
   */
  enabled: boolean = true;

  /**
   * Capability token proving a client is this room. It authorizes only this room's own scorekeeping:
   * it is not an administrative credential and cannot read or write another room.
   */
  accessToken: string;

  /** A human-friendly, non-secret way to pair a new browser with this room. */
  pairingCode: string;

  /** Display order in the Rooms list, and the order rooms are offered to the allocator */
  sortOrder: number = 0;

  /** Rounds in which this room is available; absent means every round. */
  availableRoundNumbers?: number[];

  constructor(name: string, sortOrder: number, id?: string, accessToken?: string, pairingCode?: string) {
    this.name = name;
    this.sortOrder = sortOrder;
    this.id = id ?? TournamentRoom.generateId();
    this.accessToken = accessToken ?? TournamentRoom.generateToken();
    this.pairingCode = normalizePairingCode(pairingCode) ?? TournamentRoom.generatePairingCode();
  }

  /** A fresh room id. Short and URL-safe, since it is part of the room's permanent address. */
  static generateId(): string {
    return randomId('room');
  }

  static generateToken(): string {
    return randomHex(tokenBytes);
  }

  static generatePairingCode(): string {
    return generateRandomPairingCode();
  }

  /** Generate a code that is not already used by another room in this tournament. */
  static generateUniquePairingCode(
    existingCodes: Iterable<string> = [],
    generator: () => string = TournamentRoom.generatePairingCode,
  ): string {
    const used = new Set(Array.from(existingCodes, (code) => normalizePairingCode(code)).filter(Boolean) as string[]);
    for (let attempt = 0; attempt < 10_000; attempt += 1) {
      const code = normalizePairingCode(generator());
      if (code && !used.has(code)) return code;
    }
    throw new Error('Could not generate a unique room pairing code.');
  }

  /** Repair legacy/malformed/duplicated codes while preserving every room access token. */
  static ensureUniquePairingCodes(rooms: TournamentRoom[]): number {
    const used = new Set<string>();
    let changed = 0;
    for (const room of rooms) {
      const normalized = normalizePairingCode(room.pairingCode);
      if (normalized && !used.has(normalized)) {
        if (room.pairingCode !== normalized) {
          room.pairingCode = normalized;
          changed += 1;
        }
        used.add(normalized);
        continue;
      }
      room.pairingCode = TournamentRoom.generateUniquePairingCode(used);
      used.add(room.pairingCode);
      changed += 1;
    }
    return changed;
  }

  /**
   * Issue a new token, which immediately invalidates the old room URL.
   *
   * Used when a room URL may have been shared beyond the people who should have it.
   */
  regenerateToken() {
    this.accessToken = TournamentRoom.generateToken();
  }

  /** Rotate only the human-friendly pairing code; existing room credentials keep working. */
  regeneratePairingCode(existingCodes: Iterable<string> = []) {
    this.pairingCode = TournamentRoom.generateUniquePairingCode(existingCodes);
  }

  /**
   * The permanent URL for this room.
   * @param serverAddress a LAN origin from the server's status, e.g. http://192.168.1.50:4732
   */
  url(serverAddress: string): string {
    const origin = serverAddress.replace(/\/+$/, '');
    return `${origin}/room/${encodeURIComponent(this.id)}?token=${encodeURIComponent(this.accessToken)}`;
  }

  /** Rooms are ordered by sortOrder, then by name so the list never jitter-sorts */
  static compare(a: TournamentRoom, b: TournamentRoom): number {
    return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
  }

  /**
   * The .yft representation.
   *
   * Named differently from the data model's usual `toFileObject` on purpose: a room is not a QBJ
   * object and has no QBJ form, so there is no `qbjOnly` mode to support.
   */
  toYftFileObject(): IYftFileRoom {
    return {
      id: this.id,
      name: this.name,
      description: this.description || undefined,
      enabled: this.enabled,
      accessToken: this.accessToken,
      pairingCode: this.pairingCode,
      sortOrder: this.sortOrder,
      availableRoundNumbers: this.availableRoundNumbers || undefined,
    };
  }

  /**
   * Read a room back from a .yft file.
   *
   * Anything missing or malformed is replaced rather than rejected: a tournament file is the most
   * valuable thing the director has, and a room with a regenerated token is far better than a file
   * that won't open.
   */
  static fromYftFileObject(source: unknown, fallbackSortOrder = 0): TournamentRoom | null {
    if (typeof source !== 'object' || source === null) return null;
    const data = source as Partial<IYftFileRoom>;
    if (typeof data.name !== 'string') return null;

    const room = new TournamentRoom(
      data.name,
      typeof data.sortOrder === 'number' ? data.sortOrder : fallbackSortOrder,
      typeof data.id === 'string' && data.id !== '' ? data.id : undefined,
      typeof data.accessToken === 'string' && data.accessToken !== '' ? data.accessToken : undefined,
      normalizePairingCode(data.pairingCode) ?? undefined,
    );
    if (typeof data.description === 'string') room.description = data.description;
    room.enabled = data.enabled !== false;
    if (Array.isArray(data.availableRoundNumbers)) {
      room.availableRoundNumbers = data.availableRoundNumbers.filter(
        (roundNumber): roundNumber is number => typeof roundNumber === 'number' && Number.isFinite(roundNumber),
      );
    }
    return room;
  }
}
