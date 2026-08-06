import { INavigationIntent, createNavigationIntent } from './Navigation';
import { IReadinessAction, ITournamentReadiness } from './TournamentReadiness';

/** Commands that can change or open an operational workflow from more than one surface. */
export type TournamentActionId =
  | 'add-game'
  | 'add-team'
  | 'start-server'
  | 'release-round'
  | 'review-results'
  | 'open-rebracket';

export interface ITournamentActionHandlers {
  onNavigate?: (intent: INavigationIntent) => void;
  onAddTeam?: () => void;
  onAddGame?: (roundNumber: number) => void;
  onStartServer?: () => void;
  onReleaseRound?: (roundNumber: number) => boolean | void;
  onReviewResults?: () => void;
  onOpenRebracket?: () => void;
  canReleaseRound?: (roundNumber: number) => boolean;
}

/** The readiness action must still be current when a delayed click is dispatched. */
export function dispatchReadinessAction(
  action: IReadinessAction,
  readiness: ITournamentReadiness,
  handlers: ITournamentActionHandlers,
): boolean {
  if (action.kind === 'navigate') {
    if (action.navigation) handlers.onNavigate?.(action.navigation);
    else if (action.target) handlers.onNavigate?.(createNavigationIntent(action.target));
    return true;
  }

  if (readiness.primaryAction?.kind !== action.kind) return false;

  switch (action.kind) {
    case 'start-server':
      handlers.onStartServer?.();
      return true;
    case 'release-round':
      if (action.roundNumber === undefined || handlers.canReleaseRound?.(action.roundNumber) === false) return false;
      return handlers.onReleaseRound?.(action.roundNumber) !== false;
    case 'review-results':
      handlers.onReviewResults?.();
      return true;
    case 'open-rebracket':
      handlers.onOpenRebracket?.();
      return true;
    default:
      return false;
  }
}

/** Dispatch a Quick Find command through the same capability checks as the primary operation panel. */
export function dispatchTournamentAction(
  intent: INavigationIntent,
  readiness: ITournamentReadiness,
  handlers: ITournamentActionHandlers,
): boolean {
  const actionId = intent.actionId as TournamentActionId | undefined;

  switch (actionId) {
    case 'add-team':
      if (!readiness.coreReady) return false;
      handlers.onAddTeam?.();
      return true;
    case 'add-game':
      if (!readiness.coreReady || intent.roundNumber === undefined) return false;
      handlers.onAddGame?.(intent.roundNumber);
      return true;
    case 'review-results':
      // Reviewing is navigation-only and remains safe even when another issue has superseded it as
      // the primary action. The destination can show the current conflict/inbox state.
      handlers.onReviewResults?.();
      return true;
    case 'start-server':
    case 'release-round':
    case 'open-rebracket': {
      const action: IReadinessAction = {
        kind: actionId,
        label: actionId,
        target: intent.target,
        roundNumber: intent.roundNumber,
      };
      return dispatchReadinessAction(action, readiness, handlers);
    }
    default:
      return false;
  }
}
