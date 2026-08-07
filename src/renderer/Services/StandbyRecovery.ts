/**
 * Picking a tournament up on a different computer.
 *
 * A .yft is a complete record of a tournament, but it is not a complete record of a *moment* in
 * one. Which rooms had a browser open, which sessions were live, which final was halfway through
 * being reviewed: all of that is transient state held by the server that just died, and none of it
 * is in the file. So a replacement computer opens a schedule containing games marked Playing and
 * Submitted with nothing behind them.
 *
 * The dangerous instinct is to tidy that up. Making a Playing game Ready again reads as helpful and
 * is how a room ends up scoring a game that was already played, twice, with the second copy
 * silently overwriting the first. Treating a Submitted game as Accepted invents a result nobody
 * reviewed. Both produce a tournament that looks fine and is wrong.
 *
 * So this module only ever *identifies*. It changes nothing on its own, and the one mutation it
 * offers — restarting a game — is an explicit, confirmed director action that goes through the
 * ordinary transitions and refuses outright on an accepted result.
 */
import { ScheduledMatchStatus, transitionScheduledMatch } from '../DataModel/ScheduledMatch';
import Tournament from '../DataModel/Tournament';
import { ISessionSummary, SessionStatus } from '../../main/server/ServerTypes';

/** Which kind of interruption a game is stranded by. */
export type StrandedGameKind = 'playing' | 'submitted';

/** One scheduled game the replacement computer cannot account for. */
export interface IStrandedGame {
  scheduledMatchId: string;
  kind: StrandedGameKind;
  roundNumber: number;
  roundName: string;
  leftTeam: string;
  rightTeam: string;
  roomName?: string;
  /** What the director actually has to do about it, in one sentence. */
  guidance: string;
}

/** What the renderer knows about results still in play, so this stays a pure function. */
export interface IRecoveryEvidence {
  /** Live server sessions, if any survived. */
  sessions: ISessionSummary[];
  /** Session ids of finals currently in the Match Inbox. */
  inboxSessionIds: string[];
}

const playingGuidance =
  'This game was being scored when the previous computer stopped. Do not restart it until you know what happened in the room: if the scorekeeper still has the result, import their QBJ file.';

const submittedGuidance =
  'This game’s result was submitted but never reviewed here. Get the QBJ file from the room and import it, or restart the game only if it genuinely has to be replayed.';

/**
 * Scheduled games that are mid-flight with nothing behind them.
 *
 * A game counts as stranded only when the evidence is genuinely absent. A room whose session
 * survived a restart is not stranded, and a final sitting in the Match Inbox is not stranded — it
 * is waiting, which is an entirely ordinary thing for it to be doing.
 */
export function findStrandedGames(tournament: Tournament, evidence: IRecoveryEvidence): IStrandedGame[] {
  const liveSessionMatchIds = new Set(
    evidence.sessions
      .filter(
        (session) =>
          session.scheduledMatchId !== undefined &&
          session.status !== SessionStatus.Accepted &&
          session.status !== SessionStatus.Rejected,
      )
      .map((session) => session.scheduledMatchId as string),
  );
  const inboxMatchIds = new Set(
    evidence.sessions
      .filter(
        (session) => session.scheduledMatchId !== undefined && evidence.inboxSessionIds.includes(session.sessionId),
      )
      .map((session) => session.scheduledMatchId as string),
  );

  return tournament.scheduledMatches.flatMap((scheduled) => {
    const isPlaying = scheduled.status === ScheduledMatchStatus.Playing;
    const isSubmitted = scheduled.status === ScheduledMatchStatus.Submitted;
    if (!isPlaying && !isSubmitted) return [];
    if (liveSessionMatchIds.has(scheduled.id)) return [];
    if (isSubmitted && inboxMatchIds.has(scheduled.id)) return [];

    const round = tournament.getRoundObjByNumber(scheduled.roundNumber);
    return [
      {
        scheduledMatchId: scheduled.id,
        kind: isPlaying ? ('playing' as const) : ('submitted' as const),
        roundNumber: scheduled.roundNumber,
        roundName: round?.displayName() ?? String(scheduled.roundNumber),
        leftTeam: scheduled.leftTeamName,
        rightTeam: scheduled.rightTeamName,
        roomName: scheduled.roomId
          ? tournament.rooms.find((room) => room.id === scheduled.roomId)?.name
          : scheduled.roomNameAtPlay,
        guidance: isPlaying ? playingGuidance : submittedGuidance,
      },
    ];
  });
}

export type RestartGameResult = { ok: true } | { ok: false; reason: string };

/**
 * Put a genuinely unrecoverable game back into a state a room can score again.
 *
 * The destination is NeedsAttention rather than Ready, and that is the whole design. NeedsAttention
 * is the existing explicit retry state — the one a director already produces by rejecting a
 * final — so a restarted game is startable by its room while remaining visibly flagged rather than
 * quietly indistinguishable from a game that was never played. It uses the same transition
 * function everything else does, so there is exactly one definition of a legal lifecycle.
 *
 * An accepted result is refused unconditionally. There is no situation in which restarting a game
 * whose result is already in the standings is the right move; the director wants to delete the
 * official result first, which is a different, deliberate action.
 */
export function restartScheduledGame(tournament: Tournament, scheduledMatchId: string): RestartGameResult {
  const scheduled = tournament.scheduledMatches.find((candidate) => candidate.id === scheduledMatchId);
  if (!scheduled) return { ok: false, reason: 'That scheduled game no longer exists in this tournament.' };
  if (scheduled.status === ScheduledMatchStatus.Accepted) {
    return {
      ok: false,
      reason:
        'This game already has an accepted result. Delete the recorded game first if it really has to be replayed.',
    };
  }
  if (scheduled.status === ScheduledMatchStatus.Cancelled) {
    return { ok: false, reason: 'This game was cancelled and cannot be restarted.' };
  }
  if (scheduled.status === ScheduledMatchStatus.NeedsAttention) return { ok: true };

  const transition = transitionScheduledMatch(scheduled, ScheduledMatchStatus.NeedsAttention);
  if (!transition.ok) return { ok: false, reason: transition.reason };
  return { ok: true };
}

/** The confirmation text for a restart, which has to name what is being given up. */
export function describeRestartConfirmation(game: IStrandedGame): string {
  return game.kind === 'submitted'
    ? `Round ${game.roundName}: ${game.leftTeam} vs ${game.rightTeam} was submitted but never reviewed here. Restarting means this room scores the game again from the beginning, and whatever was submitted is not recorded. If the scorekeeper still has the result, import their QBJ file instead.`
    : `Round ${game.roundName}: ${game.leftTeam} vs ${game.rightTeam} was being scored when the previous computer stopped. Restarting means the room scores it again from the beginning. If the scorekeeper still has the result, import their QBJ file instead.`;
}
