/**
 * Stable identity for the assignment set in one round.
 *
 * This is deliberately derived from schedule data rather than kept as a second counter. A saved
 * tournament reopened on another computer therefore gets the same revision, while changing a
 * pairing, room, scheduled-match identity, or cancellation produces a different one. Lifecycle
 * state such as Playing or Accepted is not part of assignment identity.
 */
export interface IRoundAssignmentRevisionEntry {
  scheduledMatchId: string;
  roundNumber: number;
  leftTeam: string;
  rightTeam: string;
  roomId?: string;
  status?: string;
}

function canonicalEntry(entry: IRoundAssignmentRevisionEntry): string {
  const teams = [entry.leftTeam, entry.rightTeam].sort().join('\u0000');
  return [
    entry.scheduledMatchId,
    teams,
    entry.roomId ?? '',
    entry.status === 'cancelled' ? 'cancelled' : 'active',
  ].join('\u0001');
}

/** Return a positive, deterministic revision number starting at 1. */
export function roundAssignmentRevision(
  entries: readonly IRoundAssignmentRevisionEntry[],
  roundNumber: number,
): number {
  const canonical = entries
    .filter((entry) => entry.roundNumber === roundNumber)
    .map(canonicalEntry)
    .sort()
    .join('\u0002');

  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < canonical.length; index += 1) {
    // eslint-disable-next-line no-bitwise
    hash ^= BigInt(canonical.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return Number(hash % 2147483646n) + 1;
}
