/**
 * Shared room-display semantics for the desktop and browser room surfaces.
 *
 * A room can have an earliest unresolved assignment that is still in a future round. That is
 * context for the room, not the game the scorekeeper should start now. The explicit release gate
 * is therefore part of selecting `current`; both clients use this function so they cannot disagree.
 */
export interface IRoomAssignmentLike {
  roundNumber: number;
  status: string;
}

export interface IRoomAssignmentSelection<T> {
  current: T | null;
  previous: T | null;
  next: T | null;
}

function isResolved(assignment: IRoomAssignmentLike): boolean {
  return assignment.status === 'accepted' || assignment.status === 'cancelled';
}

/** Select the active, previous, and next assignment for one room. */
export function selectRoomAssignments<T extends IRoomAssignmentLike>(
  assignments: T[],
  releasedRoundNumber: number | null | undefined,
  currentRoundNumber: number | null | undefined,
): IRoomAssignmentSelection<T> {
  const ordered = assignments
    .filter((assignment) => !isResolved(assignment))
    .slice()
    .sort((a, b) => a.roundNumber - b.roundNumber);
  const releaseGate = releasedRoundNumber === undefined ? currentRoundNumber ?? null : releasedRoundNumber;
  const current = ordered.find((assignment) => releaseGate !== null && assignment.roundNumber <= releaseGate) ?? null;
  const previousCandidates = assignments
    .filter(
      (assignment) =>
        assignment.status === 'accepted' && (current === null || assignment.roundNumber < current.roundNumber),
    )
    .slice()
    .sort((a, b) => a.roundNumber - b.roundNumber);
  const previous = previousCandidates[previousCandidates.length - 1] ?? null;
  const next =
    current === null
      ? ordered[0] ?? null
      : ordered.find((assignment) => assignment.roundNumber > current.roundNumber) ?? null;

  return { current, previous, next };
}
