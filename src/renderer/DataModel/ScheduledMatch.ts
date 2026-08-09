/**
 * A game the tournament intends to play, as opposed to one it has played.
 *
 * YellowFruit's `Match` means a game that happened and carries statistics. Overloading it to also
 * mean "two teams are due in room 103 at some point" would put half-real games into standings,
 * reports and validation, so a scheduled match is a separate, much smaller thing that *points at* a
 * `Match` once one exists.
 *
 * Like rooms, scheduled matches are YellowFruit's own concept and live in the .yft file's YfData.
 * Session ids and live scores are server state and are not persisted here — only the linkage that
 * survives a restart.
 *
 * Teams and phases are referenced by name/code rather than by object reference because that is
 * already how the room protocol, QBJ import, and the tournament file's own cross-references identify
 * them, and because names survive a save/load cycle without needing a resolution pass.
 */
import { randomId } from '../Utils/RandomIds';

/** Where a scheduled match is in its life */
export enum ScheduledMatchStatus {
  /** Created, but the round isn't in play yet */
  Scheduled = 'scheduled',
  /** The round is current and the room may start it */
  Ready = 'ready',
  /** A room has an open session for it */
  Playing = 'playing',
  /** A final QBJ arrived and is waiting on tournament control */
  Submitted = 'submitted',
  /** Tournament control accepted it; `resultMatchId` points at the real Match */
  Accepted = 'accepted',
  /** Tournament control rejected the submission, or something needs a human */
  NeedsAttention = 'needsAttention',
  /** Called off. Kept rather than deleted so the round's expected-game count stays explainable. */
  Cancelled = 'cancelled',
}

/** Statuses that mean the game is finished as far as scheduling is concerned */
export const resolvedStatuses: ScheduledMatchStatus[] = [ScheduledMatchStatus.Accepted, ScheduledMatchStatus.Cancelled];

export type RoomAssignmentSource = 'auto' | 'manual';

/** A scheduled match as written to a .yft file */
export interface IYftFileScheduledMatch {
  id: string;
  roundNumber: number;
  phaseCode: string;
  poolName?: string;
  leftTeamName: string;
  rightTeamName: string;
  roomId?: string;
  status: ScheduledMatchStatus;
  resultMatchId?: string;
  /** Fingerprint of the accepted portable result, when it came from QBSheet. */
  resultFingerprint?: string;
  /** Set when the pairing was generated rather than entered by hand */
  generated?: boolean;
  roomAssignmentLocked?: boolean;
  roomAssignmentSource?: RoomAssignmentSource;
  roomNameAtPlay?: string;
  /** A conservative quarantine marker for malformed persisted operational history. */
  quarantined?: boolean;
  operationalIssue?: string;
}

export enum ScheduledMatchTransitionError {
  AcceptedIsTerminal = 'AcceptedIsTerminal',
  CancelledIsTerminal = 'CancelledIsTerminal',
  InvalidSource = 'InvalidSource',
  Quarantined = 'Quarantined',
  AcceptedMatchRequired = 'AcceptedMatchRequired',
}

export interface IScheduledMatchTransitionFailure {
  ok: false;
  error: ScheduledMatchTransitionError;
  reason: string;
}

export interface IScheduledMatchTransitionSuccess {
  ok: true;
  changed: boolean;
}

export type ScheduledMatchTransitionResult = IScheduledMatchTransitionSuccess | IScheduledMatchTransitionFailure;

export class ScheduledMatch {
  id: string;

  /** The tournament round this game belongs to. The server treats this as authoritative. */
  roundNumber: number;

  /** `Phase.code` of the owning phase */
  phaseCode: string = '';

  /** `Pool.name` when the pairing came from a pool's round robin */
  poolName?: string;

  leftTeamName: string = '';

  rightTeamName: string = '';

  /** The room this game is assigned to, or undefined if it hasn't been placed yet */
  roomId?: string;

  status: ScheduledMatchStatus = ScheduledMatchStatus.Scheduled;

  /**
   * The accepted `Match` this produced.
   *
   * Set only once tournament control accepts a submission, and it is what makes accepting twice
   * detectable: a scheduled match that already has one must never gain a second.
   */
  resultMatchId?: string;

  /** Fingerprint of the accepted portable result, used to recognize a later backup QBJ. */
  resultFingerprint?: string;

  /** True when a pairing generator produced this, false when a director entered it by hand */
  generated: boolean = false;

  /** A manually selected room survives automatic rebalancing when locked. */
  roomAssignmentLocked?: boolean;

  /** Provenance for the current room id, if it has an assignment. */
  roomAssignmentSource?: RoomAssignmentSource;

  /** Room display name captured when an accepted result is recorded. */
  roomNameAtPlay?: string;

  /** Malformed persisted history is reviewable but must never be handed back to a room. */
  quarantined: boolean = false;

  /** Human-readable reason for a quarantine, persisted with the operational metadata. */
  operationalIssue?: string;

  constructor(roundNumber: number, leftTeamName: string, rightTeamName: string, id?: string) {
    this.roundNumber = roundNumber;
    this.leftTeamName = leftTeamName;
    this.rightTeamName = rightTeamName;
    this.id = id ?? randomId('sched');
  }

  /** Has this game produced an official result? */
  isAccepted(): boolean {
    return this.status === ScheduledMatchStatus.Accepted;
  }

  /** Is this game done being scheduled, either played or called off? */
  isResolved(): boolean {
    return resolvedStatuses.includes(this.status);
  }

  /**
   * Can a room still be told to play this?
   *
   * A cancelled or already-accepted game must not be handed back out, or a room could score a game
   * the tournament has already recorded.
   */
  isPlayable(): boolean {
    return !this.isResolved() && !this.quarantined;
  }

  /** Does this game involve the given team? Comparison is by name, as everywhere else. */
  involvesTeam(teamName: string): boolean {
    return this.leftTeamName === teamName || this.rightTeamName === teamName;
  }

  /** The two teams, order-insensitive, for comparing against a submission */
  teamPairKey(): string {
    return [this.leftTeamName, this.rightTeamName].slice().sort().join('\u0000');
  }

  /**
   * Do these two team names match this game's teams, in either order?
   *
   * A scorekeeper can set the teams up either way round in MODAQ, so side order is not a mismatch,
   * but playing the wrong teams entirely is.
   */
  matchesTeams(teamA: string, teamB: string): boolean {
    return [teamA, teamB].slice().sort().join('\u0000') === this.teamPairKey();
  }

  describe(): string {
    return `${this.leftTeamName} vs ${this.rightTeamName}`;
  }

  toYftFileObject(): IYftFileScheduledMatch {
    return {
      id: this.id,
      roundNumber: this.roundNumber,
      phaseCode: this.phaseCode,
      poolName: this.poolName,
      leftTeamName: this.leftTeamName,
      rightTeamName: this.rightTeamName,
      roomId: this.roomId,
      status: this.status,
      resultMatchId: this.resultMatchId,
      resultFingerprint: this.resultFingerprint,
      generated: this.generated || undefined,
      roomAssignmentLocked: this.roomAssignmentLocked || undefined,
      roomAssignmentSource: this.roomAssignmentSource || undefined,
      roomNameAtPlay: this.roomNameAtPlay || undefined,
      quarantined: this.quarantined || undefined,
      operationalIssue: this.operationalIssue,
    };
  }

  /**
   * Read a scheduled match back from a .yft file.
   *
   * Returns null for anything unusable rather than throwing, so one corrupt entry can't stop a
   * tournament file from opening.
   */
  static fromYftFileObject(source: unknown): ScheduledMatch | null {
    if (typeof source !== 'object' || source === null) return null;
    const data = source as Partial<IYftFileScheduledMatch>;
    if (typeof data.roundNumber !== 'number' || !Number.isFinite(data.roundNumber)) return null;
    if (typeof data.leftTeamName !== 'string' || typeof data.rightTeamName !== 'string') return null;
    if (data.leftTeamName === '' || data.rightTeamName === '') return null;

    const scheduled = new ScheduledMatch(
      data.roundNumber,
      data.leftTeamName,
      data.rightTeamName,
      typeof data.id === 'string' && data.id !== '' ? data.id : undefined,
    );
    if (typeof data.phaseCode === 'string') scheduled.phaseCode = data.phaseCode;
    if (typeof data.poolName === 'string') scheduled.poolName = data.poolName;
    if (typeof data.roomId === 'string') scheduled.roomId = data.roomId;
    if (typeof data.resultMatchId === 'string') scheduled.resultMatchId = data.resultMatchId;
    if (typeof data.resultFingerprint === 'string' && data.resultFingerprint !== '') {
      scheduled.resultFingerprint = data.resultFingerprint;
    }
    scheduled.generated = data.generated === true;
    if (data.roomAssignmentLocked === true) scheduled.roomAssignmentLocked = true;
    if (data.roomAssignmentSource === 'auto' || data.roomAssignmentSource === 'manual') {
      scheduled.roomAssignmentSource = data.roomAssignmentSource;
    }
    if (typeof data.roomNameAtPlay === 'string' && data.roomNameAtPlay !== '') {
      scheduled.roomNameAtPlay = data.roomNameAtPlay;
    }
    scheduled.quarantined = data.quarantined === true;
    if (typeof data.operationalIssue === 'string' && data.operationalIssue !== '') {
      scheduled.operationalIssue = data.operationalIssue;
    }

    // Older fork files did not always persist a status. A record without a result link is safely
    // recoverable as a new Scheduled game; a record that already points at a result must remain
    // review-only because guessing its lifecycle could replay history.
    const known = Object.values(ScheduledMatchStatus) as string[];
    if (typeof data.status === 'string' && known.includes(data.status)) {
      scheduled.status = data.status as ScheduledMatchStatus;
    } else if (data.status === undefined && data.resultMatchId === undefined) {
      scheduled.status = ScheduledMatchStatus.Scheduled;
    } else {
      scheduled.quarantine('The saved scheduled-match status was not recognized.');
    }

    return scheduled;
  }

  /** Put a malformed persisted record in review-only quarantine without making it playable. */
  quarantine(reason: string) {
    this.status = ScheduledMatchStatus.NeedsAttention;
    this.quarantined = true;
    this.operationalIssue = reason;
  }
}

const legalTransitions: Record<ScheduledMatchStatus, ScheduledMatchStatus[]> = {
  [ScheduledMatchStatus.Scheduled]: [
    ScheduledMatchStatus.Ready,
    ScheduledMatchStatus.Playing,
    ScheduledMatchStatus.Cancelled,
  ],
  [ScheduledMatchStatus.Ready]: [ScheduledMatchStatus.Playing, ScheduledMatchStatus.Cancelled],
  [ScheduledMatchStatus.Playing]: [ScheduledMatchStatus.Submitted, ScheduledMatchStatus.NeedsAttention],
  [ScheduledMatchStatus.Submitted]: [ScheduledMatchStatus.Accepted, ScheduledMatchStatus.NeedsAttention],
  [ScheduledMatchStatus.NeedsAttention]: [ScheduledMatchStatus.Playing, ScheduledMatchStatus.Cancelled],
  [ScheduledMatchStatus.Accepted]: [],
  [ScheduledMatchStatus.Cancelled]: [],
};

/** The only production status mutation path. Tests and parsers may construct fixture state directly. */
export function transitionScheduledMatch(
  scheduled: ScheduledMatch,
  next: ScheduledMatchStatus,
  options: { hasAcceptedResult?: boolean; clearQuarantine?: boolean } = {},
): ScheduledMatchTransitionResult {
  if (scheduled.status === next) return { ok: true, changed: false };
  if (scheduled.status === ScheduledMatchStatus.Accepted) {
    return {
      ok: false,
      error: ScheduledMatchTransitionError.AcceptedIsTerminal,
      reason: 'An accepted scheduled match is terminal and cannot be changed by a stale operation.',
    };
  }
  if (scheduled.status === ScheduledMatchStatus.Cancelled) {
    return {
      ok: false,
      error: ScheduledMatchTransitionError.CancelledIsTerminal,
      reason: 'A cancelled scheduled match is terminal and cannot be changed by normal operations.',
    };
  }
  if (scheduled.quarantined && next === ScheduledMatchStatus.Playing && !options.clearQuarantine) {
    return {
      ok: false,
      error: ScheduledMatchTransitionError.Quarantined,
      reason: scheduled.operationalIssue || 'This scheduled match needs director review before it can be played.',
    };
  }
  if (next === ScheduledMatchStatus.Accepted && !options.hasAcceptedResult) {
    return {
      ok: false,
      error: ScheduledMatchTransitionError.AcceptedMatchRequired,
      reason: 'An accepted scheduled match must be linked to exactly one official Match.',
    };
  }
  if (!legalTransitions[scheduled.status].includes(next)) {
    return {
      ok: false,
      error: ScheduledMatchTransitionError.InvalidSource,
      reason: `Cannot move a ${scheduled.status} scheduled match to ${next}.`,
    };
  }
  scheduled.status = next;
  if (options.clearQuarantine) {
    scheduled.quarantined = false;
    delete scheduled.operationalIssue;
  }
  return { ok: true, changed: true };
}
