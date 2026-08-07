/**
 * Working out whether a QBJ file the director just imported is the missing result for a game the
 * Match Plan is still waiting on.
 *
 * This is what turns a Chromebook's emergency download back into a tournament result. The round and
 * the two teams are recorded in the file, the Match Plan knows which scheduled games are still
 * unresolved, and most of the time exactly one of them fits.
 *
 * "Most of the time" is why the rules below are conservative rather than clever. A director can be
 * holding two files for the same pairing after a room was re-scored, and a file can arrive for a
 * game that has already been accepted. When the software cannot tell which scheduled game a file
 * belongs to, the safe answer is to offer nothing and let it be imported as an ordinary result — an
 * unlinked Match is a nuisance a director can fix, whereas a result silently attached to the wrong
 * scheduled game is a wrong standings table nobody goes looking for.
 *
 * What that does *not* license is refusing a pairing merely because it has occurred before. Two
 * teams can legitimately meet twice in one round — a tiebreaker, a rematch after a protest — and the
 * Match Plan is the authority on how many times. So the question asked throughout is "is there an
 * unresolved scheduled game for this, and can exactly one of them be identified?", never "has this
 * pairing already happened somewhere in this round?".
 */
import MatchImportResult, { ImportResultStatus } from '../DataModel/MatchImportResult';
import { getFileNameFromPath } from '../Utils/GeneralUtils';
import { StatsValidity } from '../DataModel/Match';
import { ScheduledMatch, ScheduledMatchStatus, transitionScheduledMatch } from '../DataModel/ScheduledMatch';
import Tournament from '../DataModel/Tournament';

/**
 * Statuses a manually imported result may resolve.
 *
 * Deliberately includes the three interrupted ones — Playing, Submitted and NeedsAttention — which
 * is what makes this the recovery route for a room whose server went away mid-game. It excludes
 * Accepted and Cancelled, which are terminal.
 */
export const resolvableStatuses: ScheduledMatchStatus[] = [
  ScheduledMatchStatus.Scheduled,
  ScheduledMatchStatus.Ready,
  ScheduledMatchStatus.Playing,
  ScheduledMatchStatus.Submitted,
  ScheduledMatchStatus.NeedsAttention,
];

/** What the import dialog needs in order to describe the candidate to the director. */
export interface IScheduledLinkSuggestion {
  scheduledMatchId: string;
  roundNumber: number;
  roundName: string;
  leftTeam: string;
  rightTeam: string;
  /** The room the Match Plan put this game in, when it has one. Context only, never a matching key. */
  roomName?: string;
  /** True when this game was interrupted rather than never started. */
  interrupted: boolean;
}

export type ScheduledLinkOutcome =
  /** Exactly one unresolved scheduled game fits. Offer it. */
  | { kind: 'candidate'; suggestion: IScheduledLinkSuggestion }
  /** Nothing in the Match Plan matches. Import it as an ordinary game. */
  | { kind: 'none' }
  /** More than one fits. Never guess: the director has to say which. */
  | { kind: 'ambiguous'; count: number }
  /** The tournament already has an official result for this pairing. It cannot be replaced here. */
  | { kind: 'accepted'; scheduledMatchId: string };

/** The authoritative facts a result carries, once the ordinary importer has resolved them. */
export interface IImportedResultIdentity {
  roundNumber: number;
  leftTeam: string;
  rightTeam: string;
  /** Only used to break a tie, and only when the source genuinely supplied it. */
  roomId?: string;
}

/**
 * Read the round and teams out of an import result.
 *
 * Taken from the resolved `Round` and `Team` objects rather than from the raw payload: the importer
 * has already reconciled the file's names against the tournament, and matching on anything less
 * resolved would mean re-implementing that reconciliation slightly differently here.
 */
export function identityOfImportResult(result: MatchImportResult): IImportedResultIdentity | null {
  const { round } = result;
  const left = result.match?.leftTeam.team?.name;
  const right = result.match?.rightTeam.team?.name;
  if (!round || typeof left !== 'string' || typeof right !== 'string' || left === '' || right === '') return null;
  return { roundNumber: round.number, leftTeam: left, rightTeam: right };
}

/** Every scheduled game in this round with these two teams, whatever its status. */
function scheduledForPairing(tournament: Tournament, identity: IImportedResultIdentity): ScheduledMatch[] {
  return tournament.scheduledMatches.filter(
    (scheduled) =>
      scheduled.roundNumber === identity.roundNumber && scheduled.matchesTeams(identity.leftTeam, identity.rightTeam),
  );
}

function describeCandidate(tournament: Tournament, scheduled: ScheduledMatch): IScheduledLinkSuggestion {
  const round = tournament.getRoundObjByNumber(scheduled.roundNumber);
  return {
    scheduledMatchId: scheduled.id,
    roundNumber: scheduled.roundNumber,
    roundName: round?.displayName() ?? String(scheduled.roundNumber),
    leftTeam: scheduled.leftTeamName,
    rightTeam: scheduled.rightTeamName,
    roomName: scheduled.roomId
      ? tournament.rooms.find((room) => room.id === scheduled.roomId)?.name
      : scheduled.roomNameAtPlay,
    interrupted:
      scheduled.status === ScheduledMatchStatus.Playing ||
      scheduled.status === ScheduledMatchStatus.Submitted ||
      scheduled.status === ScheduledMatchStatus.NeedsAttention,
  };
}

/**
 * Decide an outcome from one set of unresolved candidates and the accepted games beside them.
 *
 * Split out so the room-narrowed and un-narrowed passes cannot drift apart. The rule that matters is
 * the middle one: a lone unresolved candidate is only unambiguous when no *accepted* game for the
 * same pairing sits next to it. With one of each, the file is equally likely to be a re-export of
 * the game already recorded or the result of the second meeting, and there is nothing in the payload
 * that distinguishes them.
 */
function resolveCandidates(
  tournament: Tournament,
  candidates: ScheduledMatch[],
  accepted: ScheduledMatch[],
): ScheduledLinkOutcome {
  if (candidates.length === 0) {
    // Nothing left to fill. If the pairing was played and accepted, say so — that is more useful
    // than silently offering an ordinary import of a game the tournament already has.
    return accepted.length > 0 ? { kind: 'accepted', scheduledMatchId: accepted[0].id } : { kind: 'none' };
  }
  if (candidates.length === 1 && accepted.length === 0) {
    return { kind: 'candidate', suggestion: describeCandidate(tournament, candidates[0]) };
  }
  return { kind: 'ambiguous', count: candidates.length + accepted.length };
}

/**
 * Which unresolved scheduled game, if any, this result belongs to.
 *
 * Two teams can legitimately meet twice in one round — a tiebreaker, a rematch after a protest — and
 * the Match Plan is what says so. So "this pairing already happened somewhere in this round" is not
 * a reason to refuse: what matters is whether there is still an unresolved scheduled game for it,
 * and whether exactly one of them can be identified without guessing.
 *
 * The room narrows an otherwise ambiguous set, and only when the caller genuinely knows it. It is
 * never used to *widen* a match or to override the round and teams, because a room is where a game
 * happened and the round and teams are what the game was. It also has to distinguish the unresolved
 * game from the accepted one to help: two meetings in the same room stay ambiguous.
 */
export function suggestScheduledMatch(
  tournament: Tournament,
  identity: IImportedResultIdentity | null,
): ScheduledLinkOutcome {
  if (!identity) return { kind: 'none' };

  const forPairing = scheduledForPairing(tournament, identity);
  const candidates = forPairing.filter(
    (scheduled) => resolvableStatuses.includes(scheduled.status) && !scheduled.quarantined,
  );
  const accepted = forPairing.filter((scheduled) => scheduled.status === ScheduledMatchStatus.Accepted);

  const outcome = resolveCandidates(tournament, candidates, accepted);
  if (outcome.kind !== 'ambiguous' || identity.roomId === undefined) return outcome;

  // The room was genuinely recorded, so try again with only the games played in it. Both sides are
  // narrowed: a room that contains the unresolved game *and* the accepted one has not disambiguated
  // anything.
  const inRoom = (scheduled: ScheduledMatch) => scheduled.roomId === identity.roomId;
  const narrowed = resolveCandidates(tournament, candidates.filter(inRoom), accepted.filter(inRoom));
  return narrowed.kind === 'candidate' ? narrowed : outcome;
}

/** Convenience wrapper for the ordinary import workflow, which is always holding a result object. */
export function suggestScheduledMatchForImport(
  tournament: Tournament,
  result: MatchImportResult,
): ScheduledLinkOutcome {
  return suggestScheduledMatch(tournament, identityOfImportResult(result));
}

/** Why a scheduled import was refused, in words the director can act on. */
export type ScheduledImportResult = { ok: true; matchId: string } | { ok: false; reason: string };

/**
 * Record an imported QBJ file as the official result of one scheduled game.
 *
 * This is the only path by which a file — rather than a room session — becomes a linked
 * ScheduledMatch result, and it is deliberately the same shape as accepting a room submission:
 * one official Match, linked from exactly one scheduled game, reached through the ordinary
 * transitions. No Session is invented for it, because no session ever existed; the evidence that
 * this game happened is the file and the director who chose to import it.
 *
 * Every refusal below is a duplicate-result guard. Between them they cover the ways a director can
 * end up importing the same game twice: the file arriving after the room's own submission was
 * accepted, two copies of one download, and a damaged file that lost its result link.
 */
export function commitScheduledResult(
  tournament: Tournament,
  result: MatchImportResult,
  scheduledMatchId: string,
): ScheduledImportResult {
  const { match, round, phase, status } = result;
  if (!match || !round || !phase) return { ok: false, reason: 'This file does not contain a usable game.' };
  if (status === ImportResultStatus.FatalErr) {
    return { ok: false, reason: 'This file has errors that must be fixed before it can be imported.' };
  }

  const scheduled = tournament.scheduledMatches.find((candidate) => candidate.id === scheduledMatchId);
  if (!scheduled) return { ok: false, reason: 'That scheduled game no longer exists in this tournament.' };
  if (scheduled.isAccepted()) {
    return { ok: false, reason: 'That game already has an accepted result, which cannot be replaced by an import.' };
  }
  if (scheduled.status === ScheduledMatchStatus.Cancelled) {
    return { ok: false, reason: 'That game was cancelled and cannot be given a result.' };
  }
  if (scheduled.quarantined) {
    return { ok: false, reason: 'That game needs director review before a result can be recorded against it.' };
  }
  if (scheduled.resultMatchId) {
    // A dangling link is an integrity problem, not permission to create a second official Match.
    return { ok: false, reason: 'That game already points at a result and needs repair before an import.' };
  }

  const identity = identityOfImportResult(result);
  if (!identity) return { ok: false, reason: 'This file does not name two teams and a round.' };
  if (scheduled.roundNumber !== identity.roundNumber) {
    return { ok: false, reason: 'The round in this file does not match the scheduled game.' };
  }
  if (!scheduled.matchesTeams(identity.leftTeam, identity.rightTeam)) {
    return { ok: false, reason: 'The teams in this file do not match the scheduled game.' };
  }

  const authoritativeRound = tournament.getRoundObjByNumber(scheduled.roundNumber);
  const authoritativePhase = authoritativeRound ? tournament.whichPhaseIsRoundIn(authoritativeRound) : undefined;
  if (round !== authoritativeRound || phase !== authoritativePhase) {
    return { ok: false, reason: 'The tournament schedule changed while this file was being reviewed.' };
  }

  const officialMatches = tournament.phases.flatMap((candidatePhase) =>
    candidatePhase.rounds.flatMap((candidateRound) => candidateRound.matches),
  );
  if (officialMatches.some((existing) => existing.id === match.id)) {
    return { ok: false, reason: 'This game has already been imported.' };
  }
  if (tournament.scheduledMatches.some((candidate) => candidate.resultMatchId === match.id)) {
    return { ok: false, reason: 'This game is already linked to another scheduled game.' };
  }
  // How many times these two teams are *meant* to meet in this round, according to the Match Plan.
  // A blanket "this round already has a game between these teams" refusal would make a legitimate
  // tiebreaker or post-protest rematch impossible to recover from a file, so the schedule's own
  // count is the authority instead: one result per scheduled meeting, and no more.
  const plannedMeetings = tournament.scheduledMatches.filter(
    (candidate) =>
      candidate.roundNumber === scheduled.roundNumber &&
      candidate.matchesTeams(identity.leftTeam, identity.rightTeam) &&
      candidate.status !== ScheduledMatchStatus.Cancelled,
  ).length;
  const recordedMeetings = round.matches.filter(
    (existing) =>
      existing.leftTeam.team &&
      existing.rightTeam.team &&
      scheduled.matchesTeams(existing.leftTeam.team.name, existing.rightTeam.team.name),
  ).length;
  if (recordedMeetings >= plannedMeetings) {
    return {
      ok: false,
      reason:
        plannedMeetings === 1
          ? 'This round already has a game between these two teams.'
          : `This round already has ${recordedMeetings} of ${plannedMeetings} scheduled games between these two teams.`,
    };
  }

  // Prepare and commit as one transaction, exactly as accepting a room submission does. Validation
  // and transition helpers can still mutate the detached Match, so keep the rollback set until it
  // is visible in its round.
  const previousStatsValidity = match.statsValidity;
  const previousImportedFile = match.importedFile;
  const previousValidation = match.modalBottomValidation.makeCopy();
  const previousScheduled = {
    status: scheduled.status,
    resultMatchId: scheduled.resultMatchId,
    roomNameAtPlay: scheduled.roomNameAtPlay,
  };
  let matchAdded = false;
  try {
    if (status === ImportResultStatus.ErrNonFatal) match.statsValidity = StatsValidity.omit;
    // The bare filename, matching what an ordinary import stores, so a recovered game is
    // indistinguishable from a manually imported one everywhere downstream.
    match.importedFile = getFileNameFromPath(result.filePath);
    Tournament.validateHaveTeamsPlayedInRound(match, round, phase, false);

    // The ordinary transitions, walked in order. A game that was never started still has to pass
    // through Playing and Submitted rather than jumping straight to Accepted, so that the one place
    // that defines what a legal lifecycle is stays the one place that defines it.
    advanceToSubmitted(scheduled);
    scheduled.resultMatchId = match.id;
    const accepted = transitionScheduledMatch(scheduled, ScheduledMatchStatus.Accepted, { hasAcceptedResult: true });
    if (!accepted.ok) throw new Error(accepted.reason);

    round.addMatch(match);
    matchAdded = true;

    if (scheduled.roomId) {
      scheduled.roomNameAtPlay = tournament.rooms.find((room) => room.id === scheduled.roomId)?.name;
    }
  } catch (error: unknown) {
    if (matchAdded || round.matches.includes(match)) round.deleteMatch(match);
    match.statsValidity = previousStatsValidity;
    match.importedFile = previousImportedFile;
    match.modalBottomValidation.copyFromOther(previousValidation);
    scheduled.status = previousScheduled.status;
    scheduled.resultMatchId = previousScheduled.resultMatchId;
    scheduled.roomNameAtPlay = previousScheduled.roomNameAtPlay;
    return { ok: false, reason: error instanceof Error && error.message ? error.message : 'The import failed.' };
  }

  return { ok: true, matchId: match.id };
}

/** Walk a scheduled game up to Submitted through whichever legal steps its current status needs. */
function advanceToSubmitted(scheduled: ScheduledMatch) {
  if (scheduled.status === ScheduledMatchStatus.Submitted) return;
  if (
    scheduled.status === ScheduledMatchStatus.Scheduled ||
    scheduled.status === ScheduledMatchStatus.Ready ||
    scheduled.status === ScheduledMatchStatus.NeedsAttention
  ) {
    const playing = transitionScheduledMatch(scheduled, ScheduledMatchStatus.Playing);
    if (!playing.ok) throw new Error(playing.reason);
  }
  const submitted = transitionScheduledMatch(scheduled, ScheduledMatchStatus.Submitted);
  if (!submitted.ok) throw new Error(submitted.reason);
}
