/**
 * How a room runs a game, as opposed to how a game is scored.
 *
 * # Why this is separate from the scoring rules
 *
 * `IScorekeeperFormat` is `ScoringRules` restated, and everything in it decides what a game is worth:
 * answer values, bonus structure, overtime length, lightning. None of that varies by room. Halves,
 * clock length and timeouts are a different kind of thing — they decide how a room *conducts* the
 * round, they are not part of any statistic YellowFruit stores, and local tournaments modify them
 * routinely. NAQT itself is played in halves at some events and straight through at others, and the
 * repo's own compatibility audit notes that timing varies by audience and event.
 *
 * So they live here, optional and off by default, and the scoring engine never reads them. A room
 * with no procedure configured behaves exactly as it did before this file existed.
 *
 * # No duration is invented
 *
 * YellowFruit stores `timed` as a bare boolean and no half length anywhere, which is why the room
 * has always had to be told by the moderator that time expired. Rather than hard-coding a number
 * that would be wrong for half the tournaments that use it, the length is a setting the director
 * fills in when they want the room to show a clock, and is simply absent otherwise.
 */

/** Bumped when the shape changes. An unrecognized version is treated as no procedure at all. */
export const roomProcedureVersion = 1;

export interface IRoomProcedure {
  version: number;
  /**
   * Play is divided into halves with a score check between them.
   *
   * Purely operational: the room gets somewhere to stop, agree the score with the moderator, and
   * substitute. Nothing about the resulting `Match` changes.
   */
  halves: boolean;
  /**
   * Minutes in a half, when the room should show a clock.
   *
   * Undefined means the room is not running the clock — the moderator is, and the scorekeeper is
   * told when the half ends. This stays undefined unless a director deliberately sets it.
   */
  halfLengthMinutes?: number;
  /** Timeouts each team may take. Zero means the room does not track timeouts. */
  timeoutsPerTeam: number;
}

/** A room with nothing configured: no halves, no clock, no timeout tracking. */
export function defaultRoomProcedure(): IRoomProcedure {
  return { version: roomProcedureVersion, halves: false, timeoutsPerTeam: 0 };
}

/** Longest half a director can configure. Four hours, i.e. "this is clearly a typo" territory. */
export const maximumHalfLengthMinutes = 240;

/** The most timeouts per team the room will track. Well above any real rule set. */
export const maximumTimeoutsPerTeam = 9;

/** Does this procedure ask the room to do anything at all? */
export function roomProcedureIsActive(procedure: IRoomProcedure | undefined): procedure is IRoomProcedure {
  if (!procedure || procedure.version !== roomProcedureVersion) return false;
  return procedure.halves || procedure.timeoutsPerTeam > 0;
}

/**
 * Read a procedure that came off the wire or out of a file.
 *
 * Returns the default rather than throwing for anything unrecognizable, because a malformed setting
 * must not stop a room scoring a game. The worst case is a room that doesn't offer a halftime break
 * it was supposed to, which the scorekeeper can work around; a room that won't load cannot be.
 */
export function readRoomProcedure(value: unknown): IRoomProcedure {
  if (typeof value !== 'object' || value === null) return defaultRoomProcedure();
  const raw = value as Partial<IRoomProcedure>;
  if (raw.version !== roomProcedureVersion) return defaultRoomProcedure();

  const timeouts =
    typeof raw.timeoutsPerTeam === 'number' && Number.isInteger(raw.timeoutsPerTeam)
      ? Math.min(maximumTimeoutsPerTeam, Math.max(0, raw.timeoutsPerTeam))
      : 0;
  const halfLength =
    typeof raw.halfLengthMinutes === 'number' &&
    Number.isFinite(raw.halfLengthMinutes) &&
    raw.halfLengthMinutes > 0 &&
    raw.halfLengthMinutes <= maximumHalfLengthMinutes
      ? raw.halfLengthMinutes
      : undefined;

  return {
    version: roomProcedureVersion,
    halves: raw.halves === true,
    // A clock length with no halves to apply it to is not a rule anybody stated.
    halfLengthMinutes: raw.halves === true ? halfLength : undefined,
    timeoutsPerTeam: timeouts,
  };
}
