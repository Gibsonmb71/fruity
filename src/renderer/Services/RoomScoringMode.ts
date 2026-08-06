import { ScheduledMatch, ScheduledMatchStatus } from '../DataModel/ScheduledMatch';
import { SessionStatus } from '../../main/server/ServerTypes';
import Tournament from '../DataModel/Tournament';

/** The live states that would be orphaned if browser room scoring were disabled. */
const unsafeScheduledStatuses = new Set<ScheduledMatchStatus>([
  ScheduledMatchStatus.Playing,
  ScheduledMatchStatus.Submitted,
]);

const unsafeSessionStatuses = new Set<SessionStatus>([SessionStatus.Playing, SessionStatus.Submitted]);

export interface IRoomScoringDisableCheck {
  canDisable: boolean;
  reason?: string;
  affectedScheduledMatchIds: string[];
}

/**
 * Check the durable schedule and the ephemeral server sessions together. The durable state check
 * matters after a restart, when the main process may no longer have the session object but the
 * scheduled match is still explicitly Playing or Submitted.
 */
export function checkBrowserRoomScoringDisable(
  tournament: Tournament,
  sessions: Array<{ status?: string; scheduledMatchId?: string }> = [],
): IRoomScoringDisableCheck {
  const affectedScheduledMatchIds = tournament.scheduledMatches
    .filter((match) => unsafeScheduledStatuses.has(match.status))
    .map((match) => match.id);
  const activeSessionIds = sessions
    .filter((session) => unsafeSessionStatuses.has(session.status as SessionStatus))
    .map((session) => session.scheduledMatchId)
    .filter((id): id is string => typeof id === 'string' && id !== '');
  const allAffected = Array.from(new Set([...affectedScheduledMatchIds, ...activeSessionIds]));
  if (allAffected.length === 0) return { canDisable: true, affectedScheduledMatchIds: [] };

  return {
    canDisable: false,
    affectedScheduledMatchIds: allAffected,
    reason:
      'Browser room scoring cannot be disabled while a game is Playing or Submitted. Review or finish those live sessions first.',
  };
}

/** A small pure helper used by the UI to decide whether a clean server stop is needed. */
export function shouldStopServerBeforeDisabling(
  check: IRoomScoringDisableCheck,
  serverRunning: boolean,
): boolean {
  return check.canDisable && serverRunning;
}

/** Type guard kept next to the policy so tests and callers do not duplicate status checks. */
export function isLiveRoomState(match: ScheduledMatch): boolean {
  return unsafeScheduledStatuses.has(match.status);
}
