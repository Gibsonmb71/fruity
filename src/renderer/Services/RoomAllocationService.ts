import { Phase } from '../DataModel/Phase';
import { Round } from '../DataModel/Round';
import { RoomAssignmentSource, ScheduledMatch, ScheduledMatchStatus } from '../DataModel/ScheduledMatch';
import Tournament from '../DataModel/Tournament';
import { TournamentRoom } from '../DataModel/TournamentRoom';
import type { IScheduleIssue } from './ScheduleService';

/** Why a configured room was not eligible for a scheduled match. */
export type RoomExclusionReason =
  | 'disabled'
  | 'stage-policy'
  | 'round-override'
  | 'pool-policy'
  | 'unavailable'
  | 'unknown-phase';

export interface IExcludedRoom {
  room: TournamentRoom;
  reasons: RoomExclusionReason[];
  message: string;
}

export interface IEligibility {
  match: ScheduledMatch;
  phase?: Phase;
  round?: Round;
  eligibleRooms: TournamentRoom[];
  excludedRooms: IExcludedRoom[];
}

export interface IRoomPreference {
  preferredRoomIds?: string[];
  /** Rooms occupied by either team in the previous played round, in team order. */
  stickyRoomIds?: string[];
}

export type RoomLockInput = Set<string> | Map<string, boolean> | Record<string, boolean> | undefined;
export type RoomPreferenceInput =
  | Map<string, IRoomPreference | string[]>
  | Record<string, IRoomPreference | string[]>
  | undefined;

export type RoomAssignmentKind = 'locked' | 'frozen' | 'preserved' | 'assigned';

export interface IAllocationAssignment {
  matchId: string;
  roomId?: string;
  previousRoomId?: string;
  kind: RoomAssignmentKind;
}

export interface IUnableToAssign {
  matchId: string;
  reason: string;
  eligibleRoomIds: string[];
}

export interface IRoundAllocation {
  assignments: IAllocationAssignment[];
  unassignable: IUnableToAssign[];
  /** Alias used by the room board when it renders attention items. */
  unableToAssign: IUnableToAssign[];
  issues: IScheduleIssue[];
}

export interface IRoomChange {
  matchId: string;
  fromRoomId?: string;
  toRoomId?: string;
  reason?: string;
}

export type RoomDisableMode = 'leave-unassigned' | 'redistribute';

export interface IRebalancePlan {
  roundNumbers: number[];
  unchanged: IRoomChange[];
  moved: IRoomChange[];
  newlyAssigned: IRoomChange[];
  locked: string[];
  unableToAssign: IUnableToAssign[];
  changes: IRoomChange[];
  issues: IScheduleIssue[];
  disabledRoomId?: string;
  disableMode?: RoomDisableMode;
}

export type AutoAssignPlan = IRebalancePlan;

export interface ISwapPlan {
  kind: 'move' | 'swap' | 'illegal';
  issues: IScheduleIssue[];
  changes: IRoomChange[];
}

export type RoomDropState = 'eligible' | 'swappable' | 'unavailable' | 'protected' | 'same';

export interface IRoomDropFeedback {
  state: RoomDropState;
  issues: IScheduleIssue[];
}

interface IRoomAssignmentState {
  roomId?: string;
  roomAssignmentLocked?: boolean;
  roomAssignmentSource?: RoomAssignmentSource;
  status: ScheduledMatchStatus;
}

export interface IRoomAssignmentUndoSnapshot {
  entries: Array<{
    matchId: string;
    before: IRoomAssignmentState;
    expectedAfter: IRoomAssignmentState;
  }>;
}

export interface IAssignRoomOptions {
  /** Assignment provenance; automatic generation uses auto, controls use manual. */
  source?: RoomAssignmentSource;
  /** Set or clear the manual lock when assigning a room. */
  lock?: boolean;
  /** Explicitly release an existing lock before clearing or moving the assignment. */
  unlock?: boolean;
}

const error = (message: string, scheduledMatchIds: string[] = []): IScheduleIssue =>
  ({ severity: 'error', message, scheduledMatchIds }) as IScheduleIssue;

const warning = (message: string, scheduledMatchIds: string[] = []): IScheduleIssue =>
  ({ severity: 'warning', message, scheduledMatchIds }) as IScheduleIssue;

function orderedRooms(rooms: TournamentRoom[]): TournamentRoom[] {
  return rooms.slice().sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}

function phaseForMatch(match: ScheduledMatch, tournament: Tournament): Phase | undefined {
  return (
    tournament.phases.find((phase) => phase.code === match.phaseCode) ??
    tournament.whichPhaseIsRoundNumberIn(match.roundNumber)
  );
}

function roundForMatch(match: ScheduledMatch, phase?: Phase): Round | undefined {
  return phase?.rounds.find((round) => round.number === match.roundNumber);
}

function poolForMatch(match: ScheduledMatch, phase?: Phase) {
  return phase?.pools.find((pool) => pool.name === match.poolName);
}

function exclusionMessage(room: TournamentRoom, reasons: RoomExclusionReason[]): string {
  const labels: Record<RoomExclusionReason, string> = {
    disabled: 'room is disabled',
    'stage-policy': 'room is outside the stage room set',
    'round-override': 'room is outside the round override',
    'pool-policy': 'room is outside the locked pool preference',
    unavailable: 'room is unavailable for this round',
    'unknown-phase': 'the match stage could not be resolved',
  };
  return `${room.name || room.id}: ${reasons.map((reason) => labels[reason]).join('; ')}.`;
}

function eligibilityFor(match: ScheduledMatch, tournament: Tournament, disabledRoomId?: string): IEligibility {
  const phase = phaseForMatch(match, tournament);
  const round = roundForMatch(match, phase);
  const pool = poolForMatch(match, phase);
  const excludedRooms: IExcludedRoom[] = [];
  const eligibleRooms: TournamentRoom[] = [];

  for (const room of orderedRooms(tournament.rooms)) {
    const reasons: RoomExclusionReason[] = [];
    if (!room.enabled || room.id === disabledRoomId) reasons.push('disabled');
    if (!phase) reasons.push('unknown-phase');
    if (phase?.roomIds && !phase.roomIds.includes(room.id)) reasons.push('stage-policy');
    if (round?.roomIds && !round.roomIds.includes(room.id)) reasons.push('round-override');
    if (pool?.poolRoomsLocked && pool.preferredRoomIds && !pool.preferredRoomIds.includes(room.id)) {
      reasons.push('pool-policy');
    }
    if (room.availableRoundNumbers && !room.availableRoundNumbers.includes(match.roundNumber)) {
      reasons.push('unavailable');
    }

    if (reasons.length === 0) eligibleRooms.push(room);
    else excludedRooms.push({ room, reasons, message: exclusionMessage(room, reasons) });
  }

  return { match, phase, round, eligibleRooms, excludedRooms };
}

/** Resolve the intersection of enabled, stage, round, pool, and room-availability policy. */
export function resolveEligibleRooms(match: ScheduledMatch, tournament: Tournament): IEligibility {
  return eligibilityFor(match, tournament);
}

function lockIncludes(locks: RoomLockInput, matchId: string): boolean {
  if (!locks) return false;
  if (locks instanceof Set) return locks.has(matchId);
  if (locks instanceof Map) return locks.get(matchId) === true;
  return locks[matchId] === true;
}

function preferenceFor(preferences: RoomPreferenceInput, matchId: string): IRoomPreference {
  if (!preferences) return {};
  const raw = preferences instanceof Map ? preferences.get(matchId) : preferences[matchId];
  if (!raw) return {};
  return Array.isArray(raw) ? { preferredRoomIds: raw } : raw;
}

function isLifecycleFrozen(match: ScheduledMatch): boolean {
  return (
    match.status === ScheduledMatchStatus.Playing ||
    match.status === ScheduledMatchStatus.Submitted ||
    match.status === ScheduledMatchStatus.Accepted
  );
}

function roomUnavailableReason(match: ScheduledMatch, eligibility: IEligibility): string {
  if (eligibility.eligibleRooms.length === 0) {
    return `No eligible rooms are available for ${match.describe()} in round ${match.roundNumber}.`;
  }
  return `All eligible rooms are already reserved in round ${match.roundNumber}.`;
}

function sortedMatches(matches: ScheduledMatch[]): ScheduledMatch[] {
  return matches
    .slice()
    .sort(
      (a, b) =>
        (a.poolName ?? '').localeCompare(b.poolName ?? '') ||
        a.leftTeamName.localeCompare(b.leftTeamName) ||
        a.rightTeamName.localeCompare(b.rightTeamName) ||
        a.id.localeCompare(b.id),
    );
}

function candidateRooms(
  match: ScheduledMatch,
  eligibility: IEligibility,
  preference: IRoomPreference,
  takenRoomIds: Set<string>,
): TournamentRoom[] {
  const available = eligibility.eligibleRooms.filter((room) => !takenRoomIds.has(room.id));
  const preferredIds = new Set(preference.preferredRoomIds ?? []);
  const preferred = available.filter((room) => preferredIds.has(room.id));
  const stickyIds = new Set(preference.stickyRoomIds ?? []);
  const sticky = available.filter((room) => stickyIds.has(room.id));
  const firstFree = available.filter((room) => !preferredIds.has(room.id) && !stickyIds.has(room.id));
  return [...preferred, ...sticky, ...firstFree];
}

/**
 * Allocate one round. The input objects are never mutated; callers decide whether to apply the
 * returned room ids. Existing valid assignments win over all preference heuristics.
 */
export function allocateRound(
  matches: ScheduledMatch[],
  eligibleByMatch: Map<string, IEligibility> | Record<string, IEligibility>,
  locks?: RoomLockInput,
  preferences?: RoomPreferenceInput,
): IRoundAllocation {
  const assignments: IAllocationAssignment[] = [];
  const unassignable: IUnableToAssign[] = [];
  const issues: IScheduleIssue[] = [];
  const takenRoomIds = new Set<string>();
  const getEligibility = (match: ScheduledMatch) =>
    eligibleByMatch instanceof Map ? eligibleByMatch.get(match.id) : eligibleByMatch[match.id];

  const preserve = (match: ScheduledMatch, kind: RoomAssignmentKind) => {
    assignments.push({ matchId: match.id, roomId: match.roomId, previousRoomId: match.roomId, kind });
    if (match.roomId) takenRoomIds.add(match.roomId);
  };

  // Locked and lifecycle-frozen games reserve their current room before any free game is considered.
  for (const match of sortedMatches(matches)) {
    const eligibility = getEligibility(match);
    if (!eligibility) continue;
    const locked = match.roomAssignmentLocked === true || lockIncludes(locks, match.id);
    if (locked) {
      preserve(match, 'locked');
      if (!match.roomId) {
        const unable = { matchId: match.id, reason: 'Locked assignment has no room.', eligibleRoomIds: [] };
        unassignable.push(unable);
        issues.push(error(`${match.describe()} is locked but has no room assignment.`, [match.id]));
      } else if (!eligibility.eligibleRooms.some((room) => room.id === match.roomId)) {
        const excluded = eligibility.excludedRooms.find((item) => item.room.id === match.roomId);
        const reason = excluded?.message ?? 'room is not eligible for this match';
        unassignable.push({ matchId: match.id, reason, eligibleRoomIds: eligibility.eligibleRooms.map((r) => r.id) });
        issues.push(error(`${match.describe()} is locked to ${reason}`, [match.id]));
      }
    }
  }

  for (const match of sortedMatches(matches)) {
    if (match.roomAssignmentLocked || isLifecycleFrozen(match)) {
      if (!assignments.some((assignment) => assignment.matchId === match.id)) preserve(match, 'frozen');
    }
  }

  // Preserve valid future assignments next, which prevents a needless 101 → 104 → 101 cascade.
  for (const match of sortedMatches(matches)) {
    const eligibility = getEligibility(match);
    if (!eligibility || match.status === ScheduledMatchStatus.Cancelled || isLifecycleFrozen(match)) continue;
    if (match.roomAssignmentLocked) continue;
    if (
      match.roomId &&
      eligibility.eligibleRooms.some((room) => room.id === match.roomId) &&
      !takenRoomIds.has(match.roomId)
    ) {
      preserve(match, 'preserved');
    }
  }

  for (const match of sortedMatches(matches)) {
    const eligibility = getEligibility(match);
    if (!eligibility || match.status === ScheduledMatchStatus.Cancelled) continue;
    if (assignments.some((assignment) => assignment.matchId === match.id)) continue;

    const room = candidateRooms(match, eligibility, preferenceFor(preferences, match.id), takenRoomIds)[0];
    if (!room) {
      unassignable.push({
        matchId: match.id,
        reason: roomUnavailableReason(match, eligibility),
        eligibleRoomIds: eligibility.eligibleRooms.map((candidate) => candidate.id),
      });
      issues.push(warning(`${match.describe()}: ${roomUnavailableReason(match, eligibility)}`, [match.id]));
      continue;
    }

    takenRoomIds.add(room.id);
    assignments.push({ matchId: match.id, roomId: room.id, previousRoomId: match.roomId, kind: 'assigned' });
  }

  return { assignments, unassignable, unableToAssign: unassignable, issues };
}

function matchNumbersFor(tournament: Tournament, roundNumbers: number[]): number[] {
  if (roundNumbers.length > 0) return Array.from(new Set(roundNumbers)).sort((a, b) => a - b);
  return Array.from(new Set(tournament.scheduledMatches.map((match) => match.roundNumber))).sort((a, b) => a - b);
}

function stickyRoomsForRound(tournament: Tournament, roundNumber: number, match: ScheduledMatch): string[] {
  const previous = tournament.scheduledMatches
    .filter(
      (candidate) =>
        candidate.roundNumber < roundNumber && candidate.roomId && candidate.status !== ScheduledMatchStatus.Cancelled,
    )
    .sort((a, b) => b.roundNumber - a.roundNumber || a.id.localeCompare(b.id));
  const result: string[] = [];
  for (const teamName of [match.leftTeamName, match.rightTeamName]) {
    const prior = previous.find((candidate) => candidate.involvesTeam(teamName));
    if (prior?.roomId && !result.includes(prior.roomId)) result.push(prior.roomId);
  }
  return result;
}

function planRebalanceInternal(
  tournament: Tournament,
  roundNumbers: number[],
  disabledRoomId?: string,
): IRebalancePlan {
  const numbers = matchNumbersFor(tournament, roundNumbers);
  const plan: IRebalancePlan = {
    roundNumbers: numbers,
    unchanged: [],
    moved: [],
    newlyAssigned: [],
    locked: [],
    unableToAssign: [],
    changes: [],
    issues: [],
  };

  for (const roundNumber of numbers) {
    const matches = tournament.scheduledMatches.filter((match) => match.roundNumber === roundNumber);
    const eligibilityByMatch = new Map(
      matches.map((match) => [match.id, eligibilityFor(match, tournament, disabledRoomId)]),
    );
    const preferences = new Map<string, IRoomPreference>();
    for (const match of matches) {
      const phase = eligibilityByMatch.get(match.id)?.phase;
      const pool = poolForMatch(match, phase);
      preferences.set(match.id, {
        preferredRoomIds: pool?.preferredRoomIds,
        stickyRoomIds: stickyRoomsForRound(tournament, roundNumber, match),
      });
    }
    const allocation = allocateRound(matches, eligibilityByMatch, undefined, preferences);
    plan.issues.push(...allocation.issues);
    plan.unableToAssign.push(...allocation.unassignable);

    for (const assignment of allocation.assignments) {
      const match = matches.find((candidate) => candidate.id === assignment.matchId);
      if (!match) continue;
      const change = {
        matchId: match.id,
        fromRoomId: match.roomId,
        toRoomId: assignment.roomId,
      };
      if (assignment.kind === 'locked' || assignment.kind === 'frozen' || match.roomAssignmentLocked) {
        plan.locked.push(match.id);
      }
      if (assignment.roomId === match.roomId) {
        plan.unchanged.push(change);
      } else if (assignment.roomId) {
        const moved = { ...change, reason: assignment.kind === 'assigned' ? 'automatic allocation' : undefined };
        if (match.roomId) plan.moved.push(moved);
        else plan.newlyAssigned.push(moved);
        plan.changes.push(moved);
      } else if (match.roomId && !isLifecycleFrozen(match) && !match.roomAssignmentLocked) {
        const moved = { ...change, reason: 'no eligible room available' };
        plan.moved.push(moved);
        plan.changes.push(moved);
      }
    }
  }

  return plan;
}

/** Plan a churn-minimizing rebalance for the selected round numbers. */
export function planRebalance(tournament: Tournament, roundNumbers: number[]): IRebalancePlan {
  return planRebalanceInternal(tournament, roundNumbers);
}

/** Apply a previously reviewed plan. This is the only bulk-mutating entry point. */
export function applyRebalance(tournament: Tournament, plan: IRebalancePlan): void {
  if (plan.issues.some((issue) => issue.severity === 'error')) return;
  if (plan.disabledRoomId) {
    const room = tournament.rooms.find((candidate) => candidate.id === plan.disabledRoomId);
    if (room) room.enabled = false;
  }
  for (const change of plan.changes) {
    const match = tournament.scheduledMatches.find((candidate) => candidate.id === change.matchId);
    if (!match || match.roomAssignmentLocked || isLifecycleFrozen(match)) continue;
    assignRoom(tournament, match.id, change.toRoomId, { source: 'auto', unlock: true });
  }
}

/**
 * Build a plan that only fills currently unassigned future games. Existing room choices are
 * treated as fixed, including choices that are no longer eligible; the preview will report those
 * conflicts instead of silently moving a director's work.
 */
export function planAutoAssignUnassigned(tournament: Tournament, roundNumbers: number[] = []): AutoAssignPlan {
  const numbers = matchNumbersFor(tournament, roundNumbers);
  const plan: AutoAssignPlan = {
    roundNumbers: numbers,
    unchanged: [],
    moved: [],
    newlyAssigned: [],
    locked: [],
    unableToAssign: [],
    changes: [],
    issues: [],
  };

  for (const roundNumber of numbers) {
    const matches = tournament.scheduledMatches.filter((match) => match.roundNumber === roundNumber);
    const takenRoomIds = new Set(
      matches
        .filter((match) => match.roomId && match.status !== ScheduledMatchStatus.Cancelled)
        .map((match) => match.roomId as string),
    );
    const unassigned = sortedMatches(matches).filter(
      (match) => !match.roomId && match.status !== ScheduledMatchStatus.Cancelled,
    );

    for (const match of unassigned) {
      const eligibility = resolveEligibleRooms(match, tournament);
      if (match.roomAssignmentLocked) {
        const unable = { matchId: match.id, reason: 'Locked assignment has no room.', eligibleRoomIds: [] };
        plan.locked.push(match.id);
        plan.unableToAssign.push(unable);
        plan.issues.push(error(`${match.describe()} is locked but has no room assignment.`, [match.id]));
        continue;
      }
      const room = eligibility.eligibleRooms.find((candidate) => !takenRoomIds.has(candidate.id));
      if (!room) {
        const reason = roomUnavailableReason(match, eligibility);
        plan.unableToAssign.push({
          matchId: match.id,
          reason,
          eligibleRoomIds: eligibility.eligibleRooms.map((candidate) => candidate.id),
        });
        plan.issues.push(warning(`${match.describe()}: ${reason}`, [match.id]));
        continue;
      }

      takenRoomIds.add(room.id);
      const change = { matchId: match.id, toRoomId: room.id, reason: 'fill unassigned game' };
      plan.newlyAssigned.push(change);
      plan.changes.push(change);
    }

    matches
      .filter((match) => match.roomId || match.status === ScheduledMatchStatus.Cancelled)
      .forEach((match) => {
        plan.unchanged.push({ matchId: match.id, fromRoomId: match.roomId, toRoomId: match.roomId });
      });
  }

  return plan;
}

/** Plan what happens when a room is disabled, without changing the room or its history. */
export function planRoomDisable(tournament: Tournament, roomId: string, mode: RoomDisableMode): IRebalancePlan {
  const plan = planRebalanceInternal(tournament, [], roomId);
  plan.disabledRoomId = roomId;
  plan.disableMode = mode;

  if (mode === 'leave-unassigned') {
    plan.changes = [];
    plan.moved = [];
    plan.newlyAssigned = [];
    plan.unableToAssign = [];
    const affected = tournament.scheduledMatches.filter(
      (match) =>
        match.roomId === roomId &&
        !match.roomAssignmentLocked &&
        !isLifecycleFrozen(match) &&
        match.status !== ScheduledMatchStatus.Cancelled,
    );
    for (const match of affected) {
      const change = { matchId: match.id, fromRoomId: roomId, reason: 'room disabled; left unassigned' };
      plan.moved.push(change);
      plan.changes.push(change);
      plan.unableToAssign.push({
        matchId: match.id,
        reason: `Room ${roomId} is disabled; the match will remain unassigned.`,
        eligibleRoomIds: [],
      });
    }
  }
  return plan;
}

function issueForIneligibleRoom(match: ScheduledMatch, targetRoom: TournamentRoom, eligibility: IEligibility) {
  const excluded = eligibility.excludedRooms.find((item) => item.room.id === targetRoom.id);
  return error(
    `${targetRoom.name} is not eligible for ${match.describe()} in round ${match.roundNumber}${
      excluded ? ` (${excluded.message})` : '.'
    }`,
    [match.id],
  );
}

/** Plan a move or room swap; only legal plans are presented as move/swap. */
export function planSwap(tournament: Tournament, matchId: string, targetRoomId: string): ISwapPlan {
  const match = tournament.scheduledMatches.find((candidate) => candidate.id === matchId);
  const targetRoom = tournament.rooms.find((room) => room.id === targetRoomId);
  if (!match) return { kind: 'illegal', issues: [error('That scheduled match no longer exists.')], changes: [] };
  if (!targetRoom) return { kind: 'illegal', issues: [error('That room no longer exists.', [match.id])], changes: [] };
  if (match.status === ScheduledMatchStatus.Playing) {
    const roomName = tournament.rooms.find((room) => room.id === match.roomId)?.name ?? match.roomId ?? 'its room';
    return {
      kind: 'illegal',
      issues: [
        error(
          `Game is already in progress in ${roomName}. Room assignment cannot be changed while scoring is active.`,
          [match.id],
        ),
      ],
      changes: [],
    };
  }
  if (
    match.status === ScheduledMatchStatus.Submitted ||
    match.status === ScheduledMatchStatus.Accepted ||
    match.status === ScheduledMatchStatus.Cancelled
  ) {
    return {
      kind: 'illegal',
      issues: [error('Historical or cancelled games cannot be reassigned.', [match.id])],
      changes: [],
    };
  }
  if (match.roomAssignmentLocked) {
    return { kind: 'illegal', issues: [error('This room assignment is locked.', [match.id])], changes: [] };
  }

  const eligibility = resolveEligibleRooms(match, tournament);
  if (!eligibility.eligibleRooms.some((room) => room.id === targetRoomId)) {
    return { kind: 'illegal', issues: [issueForIneligibleRoom(match, targetRoom, eligibility)], changes: [] };
  }
  if (match.roomId === targetRoomId) return { kind: 'move', issues: [], changes: [] };

  const occupant = tournament.scheduledMatches.find(
    (candidate) =>
      candidate.id !== match.id &&
      candidate.roundNumber === match.roundNumber &&
      candidate.roomId === targetRoomId &&
      candidate.status !== ScheduledMatchStatus.Cancelled,
  );
  if (!occupant) {
    return {
      kind: 'move',
      issues: [],
      changes: [{ matchId: match.id, fromRoomId: match.roomId, toRoomId: targetRoomId }],
    };
  }
  if (occupant.roomAssignmentLocked || isLifecycleFrozen(occupant)) {
    return {
      kind: 'illegal',
      issues: [error(`${targetRoom.name} is occupied by a protected game.`, [match.id, occupant.id])],
      changes: [],
    };
  }
  const occupantEligibility = resolveEligibleRooms(occupant, tournament);
  if (!occupantEligibility.eligibleRooms.some((room) => room.id === match.roomId)) {
    const sourceRoom = tournament.rooms.find((room) => room.id === match.roomId);
    const issue = sourceRoom
      ? issueForIneligibleRoom(occupant, sourceRoom, occupantEligibility)
      : error(`${occupant.describe()} has no legal room for the swap.`, [match.id, occupant.id]);
    return { kind: 'illegal', issues: [issue], changes: [] };
  }

  return {
    kind: 'swap',
    issues: [],
    changes: [
      { matchId: match.id, fromRoomId: match.roomId, toRoomId: targetRoomId },
      { matchId: occupant.id, fromRoomId: targetRoomId, toRoomId: match.roomId },
    ],
  };
}

/** Derive board drop feedback from the same allocation validation used by mutations. */
export function getRoomDropFeedback(tournament: Tournament, matchId: string, targetRoomId: string): IRoomDropFeedback {
  const match = tournament.scheduledMatches.find((candidate) => candidate.id === matchId);
  if (!match) return { state: 'unavailable', issues: [error('That scheduled match no longer exists.')] };
  if (targetRoomId === '' || targetRoomId === '__unassigned__') {
    if (match.roomId === undefined) return { state: 'same', issues: [] };
    if (match.status === ScheduledMatchStatus.Playing || match.status === ScheduledMatchStatus.Submitted || match.status === ScheduledMatchStatus.Accepted || match.status === ScheduledMatchStatus.Cancelled) {
      return { state: 'protected', issues: [error('Historical or in-flight games cannot be unassigned.', [match.id])] };
    }
    if (match.roomAssignmentLocked) return { state: 'protected', issues: [error('This room assignment is locked.', [match.id])] };
    return { state: 'eligible', issues: [] };
  }
  const plan = planSwap(tournament, matchId, targetRoomId);
  if (plan.kind === 'illegal') {
    const protectedTarget = plan.issues.some((candidate) => /protected|locked|in progress|historical|cancelled/i.test(candidate.message));
    return { state: protectedTarget ? 'protected' : 'unavailable', issues: plan.issues };
  }
  if (plan.kind === 'swap') return { state: 'swappable', issues: [] };
  if (plan.changes.length === 0) return { state: 'same', issues: [] };
  return { state: 'eligible', issues: [] };
}

function assignmentState(match: ScheduledMatch): IRoomAssignmentState {
  return {
    roomId: match.roomId,
    roomAssignmentLocked: match.roomAssignmentLocked,
    roomAssignmentSource: match.roomAssignmentSource,
    status: match.status,
  };
}

/** Capture the exact assignment/provenance state for a room mutation. */
export function createRoomAssignmentUndoSnapshot(tournament: Tournament, matchIds: string[]): IRoomAssignmentUndoSnapshot {
  return {
    entries: Array.from(new Set(matchIds))
      .map((matchId) => tournament.scheduledMatches.find((match) => match.id === matchId))
      .filter((match): match is ScheduledMatch => match !== undefined)
      .map((match) => ({ matchId: match.id, before: assignmentState(match), expectedAfter: assignmentState(match) })),
  };
}

/** Complete a snapshot after a successful mutation so undo can reject stale state safely. */
export function finalizeRoomAssignmentUndoSnapshot(
  tournament: Tournament,
  snapshot: IRoomAssignmentUndoSnapshot,
): IRoomAssignmentUndoSnapshot {
  return {
    entries: snapshot.entries.map((entry) => {
      const match = tournament.scheduledMatches.find((candidate) => candidate.id === entry.matchId);
      return match ? { ...entry, expectedAfter: assignmentState(match) } : entry;
    }),
  };
}

/** Restore a targeted snapshot only while every affected game is still in the same editable lifecycle. */
export function restoreRoomAssignmentUndoSnapshot(
  tournament: Tournament,
  snapshot: IRoomAssignmentUndoSnapshot,
): { restored: boolean; reason?: string } {
  for (const entry of snapshot.entries) {
    const match = tournament.scheduledMatches.find((candidate) => candidate.id === entry.matchId);
    if (!match) return { restored: false, reason: 'A scheduled game no longer exists.' };
    if (match.status !== entry.before.status || isLifecycleFrozen(match)) {
      return { restored: false, reason: 'A game in that assignment has already advanced and cannot be undone.' };
    }
    const current = assignmentState(match);
    if (
      current.roomId !== entry.expectedAfter.roomId ||
      current.roomAssignmentLocked !== entry.expectedAfter.roomAssignmentLocked ||
      current.roomAssignmentSource !== entry.expectedAfter.roomAssignmentSource
    ) {
      return { restored: false, reason: 'The room plan changed again, so the older assignment is no longer safe to restore.' };
    }
  }
  snapshot.entries.forEach((entry) => {
    const match = tournament.scheduledMatches.find((candidate) => candidate.id === entry.matchId);
    if (!match) return;
    match.roomId = entry.before.roomId;
    match.roomAssignmentLocked = entry.before.roomAssignmentLocked;
    match.roomAssignmentSource = entry.before.roomAssignmentSource;
  });
  return { restored: true };
}

/**
 * Apply a validated move or swap in one mutation. The plan is revalidated immediately before any
 * field is changed, so a stale board drop cannot leave the first half of a swap applied.
 */
export function applySwapPlan(tournament: Tournament, plan: ISwapPlan): IScheduleIssue[] {
  if (plan.kind === 'illegal') return plan.issues;
  if (plan.changes.length === 0) return [];

  const first = plan.changes[0];
  if (!first.toRoomId) {
    return assignRoom(tournament, first.matchId, undefined);
  }

  const currentPlan = planSwap(tournament, first.matchId, first.toRoomId);
  if (currentPlan.kind !== plan.kind || currentPlan.changes.length !== plan.changes.length) {
    return [error('The Match Plan changed while this move was being reviewed. Please try again.', [first.matchId])];
  }
  const expected = new Map(plan.changes.map((change) => [change.matchId, change.toRoomId]));
  const actual = new Map(currentPlan.changes.map((change) => [change.matchId, change.toRoomId]));
  if (expected.size !== actual.size || [...expected].some(([matchId, roomId]) => actual.get(matchId) !== roomId)) {
    return [error('The Match Plan changed while this move was being reviewed. Please try again.', [first.matchId])];
  }

  const changedMatches = plan.changes.map((change) =>
    tournament.scheduledMatches.find((candidate) => candidate.id === change.matchId),
  );
  if (changedMatches.some((match) => !match)) {
    return [
      error(
        'A scheduled match in this move no longer exists.',
        plan.changes.map((change) => change.matchId),
      ),
    ];
  }

  plan.changes.forEach((change) => {
    const match = tournament.scheduledMatches.find((candidate) => candidate.id === change.matchId);
    if (!match) return;
    match.roomId = change.toRoomId;
    match.roomAssignmentSource = change.toRoomId ? 'manual' : undefined;
    match.roomAssignmentLocked = undefined;
  });
  return [];
}

/**
 * The single assignment write path. Validation is performed before any field is changed, so a
 * caller can show the returned issues without needing to roll anything back.
 */
export function assignRoom(
  tournament: Tournament,
  matchId: string,
  roomId: string | undefined,
  options: IAssignRoomOptions = {},
): IScheduleIssue[] {
  const match = tournament.scheduledMatches.find((candidate) => candidate.id === matchId);
  if (!match) return [error('That scheduled match no longer exists.')];
  if (match.status === ScheduledMatchStatus.Playing) {
    const roomName = tournament.rooms.find((room) => room.id === match.roomId)?.name ?? match.roomId ?? 'its room';
    return [
      error(`Game is already in progress in ${roomName}. Room assignment cannot be changed while scoring is active.`, [
        match.id,
      ]),
    ];
  }
  if (match.status === ScheduledMatchStatus.Submitted || match.status === ScheduledMatchStatus.Accepted) {
    return [error('Historical or cancelled games cannot be reassigned.', [match.id])];
  }
  if (match.status === ScheduledMatchStatus.Cancelled && roomId !== undefined) {
    return [error('Historical or cancelled games cannot be reassigned.', [match.id])];
  }
  if (match.roomAssignmentLocked && !options.unlock && roomId !== match.roomId) {
    return [error('This room assignment is locked.', [match.id])];
  }

  if (roomId !== undefined) {
    const room = tournament.rooms.find((candidate) => candidate.id === roomId);
    if (!room) return [error('That room no longer exists.', [match.id])];
    const eligibility = resolveEligibleRooms(match, tournament);
    if (!eligibility.eligibleRooms.some((candidate) => candidate.id === roomId)) {
      return [issueForIneligibleRoom(match, room, eligibility)];
    }
    const occupant = tournament.scheduledMatches.find(
      (candidate) =>
        candidate.id !== match.id &&
        candidate.roundNumber === match.roundNumber &&
        candidate.roomId === roomId &&
        candidate.status !== ScheduledMatchStatus.Cancelled,
    );
    if (occupant) {
      return [
        error(`${room.name} already has a game in round ${match.roundNumber} (${occupant.describe()}).`, [
          match.id,
          occupant.id,
        ]),
      ];
    }
  }

  match.roomId = roomId;
  match.roomAssignmentSource = roomId ? options.source ?? 'manual' : undefined;
  match.roomAssignmentLocked = roomId && options.lock ? true : undefined;
  return [];
}
