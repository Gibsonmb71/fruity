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
  /** Ephemeral executable command metadata used by the command palette and destination handlers. */
  actionId?: string;
  gamesReviewFilter?: GamesReviewFilter;
  /** The single focus vocabulary used by all destinations. */
  focus?: 'result-inbox' | 'scheduled-match' | 'room' | 'round';
}

export type GamesReviewFilter = 'all' | 'needs-review' | 'errors' | 'warnings';

/** Metadata accepted by helpers before the destination is attached. */
export type INavigationPayload = Omit<INavigationIntent, 'target'>;

export function createNavigationIntent(target: ReadinessTarget, payload: INavigationPayload = {}): INavigationIntent {
  const allowedByTarget: Record<ReadinessTarget, Array<keyof INavigationPayload>> = {
    'setup:tournament': ['actionId'],
    'setup:rules': ['actionId'],
    'setup:teams': ['actionId'],
    'setup:format': ['actionId'],
    games: ['actionId', 'roundNumber', 'matchId', 'matchIds', 'teamName', 'gamesReviewFilter', 'focus'],
    'control:live': [
      'actionId',
      'roundNumber',
      'scheduledMatchId',
      'scheduledMatchIds',
      'phaseCode',
      'gamesReviewFilter',
      'focus',
    ],
    'control:match-plan': ['actionId', 'roundNumber', 'scheduledMatchId', 'scheduledMatchIds', 'phaseCode', 'focus'],
    'control:rooms': ['actionId', 'roomId', 'focus'],
    'control:display': ['actionId'],
    reports: ['actionId'],
  };
  const allowed = new Set(allowedByTarget[target]);
  const normalized: INavigationIntent = { target };
  for (const key of Object.keys(payload) as Array<keyof INavigationPayload>) {
    if (allowed.has(key) && payload[key] !== undefined) normalized[key] = payload[key] as never;
  }
  return normalized;
}
