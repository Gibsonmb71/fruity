import type { ReadinessTarget } from './TournamentReadiness';

/**
 * One internal navigation contract for issue clicks, primary actions, Quick Find, and deep page
 * focus. The target and its context travel together so an issue cannot lose its match or round on
 * the way to the destination page.
 */
export interface INavigationIntent {
  target: ReadinessTarget;
  roundNumber?: number;
  matchId?: string;
  matchIds?: string[];
  scheduledMatchId?: string;
  scheduledMatchIds?: string[];
  teamName?: string;
  phaseCode?: string;
  roomId?: string;
  gamesReviewFilter?: 'all' | 'needs-review' | 'errors' | 'warnings';
  controlFocus?: 'inbox' | 'current-round' | 'match-plan';
  /** Legacy focus vocabulary kept as a wire-compatible alias while callers migrate. */
  focus?: 'result-inbox' | 'scheduled-match' | 'room' | 'round';
}

/** Metadata accepted by helpers before the destination is attached. */
export type INavigationPayload = Omit<INavigationIntent, 'target'>;

export function createNavigationIntent(target: ReadinessTarget, payload: INavigationPayload = {}): INavigationIntent {
  return { target, ...payload };
}
