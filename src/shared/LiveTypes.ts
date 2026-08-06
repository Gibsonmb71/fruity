/**
 * Data shared by the Electron renderer, the local Tournament Server, and the public browser
 * applications. These are deliberately plain JSON DTOs: no YellowFruit model objects or server
 * credentials cross the public boundary.
 */

export type LiveDisplayTheme = 'system' | 'light' | 'dark';

export type LiveDisplayMode = 'standings' | 'individuals' | 'pools' | 'results' | 'next-round';

export interface ILiveDisplaySlides {
  teamStandings: boolean;
  individuals: boolean;
  pools: boolean;
  recentResults: boolean;
  nextRound: boolean;
}

export interface ILiveDisplaySettings {
  enabled: boolean;
  /** Separate audience-facing pairings page; it does not imply the slideshow is enabled. */
  publicPairingsEnabled?: boolean;
  slides: ILiveDisplaySlides;
  slideDurationSeconds: 5 | 10 | 15 | 20 | 30;
  rowsPerSlide: number;
  theme: LiveDisplayTheme;
  showLastUpdated: boolean;
}

export const defaultLiveDisplaySettings: ILiveDisplaySettings = {
  enabled: false,
  publicPairingsEnabled: false,
  slides: {
    teamStandings: true,
    individuals: true,
    pools: true,
    recentResults: true,
    nextRound: true,
  },
  slideDurationSeconds: 10,
  rowsPerSlide: 10,
  theme: 'system',
  showLastUpdated: true,
};

export interface IPublicLiveSettings {
  slides: ILiveDisplaySlides;
  slideDurationSeconds: 5 | 10 | 15 | 20 | 30;
  rowsPerSlide: number;
  theme: LiveDisplayTheme;
  showLastUpdated: boolean;
}

export interface IPublicAnswerCount {
  value: number;
  label: string;
  shortLabel: string;
  count: number;
}

export interface IPublicTeamStanding {
  rank: string;
  teamName: string;
  record: string;
  wins: number;
  losses: number;
  ties: number;
  winPct: number | null;
  /** Points per standard regulation tossups, matching YellowFruit's standings report. */
  ppg: number | null;
  /** Points per bonus, or null when the rules do not use bonuses / no bonuses were heard. */
  ppb: number | null;
  tossupsHeard: number;
  totalPoints: number;
  lightningPerGame: number | null;
}

export interface IPublicIndividualStanding {
  rank: string;
  playerName: string;
  teamName: string;
  gamesPlayed: number;
  tossupsHeard: number;
  /** Points per standard regulation tossups, matching YellowFruit's individuals report. */
  pptuh: number | null;
  totalPoints: number;
  answerCounts: IPublicAnswerCount[];
}

export interface IPublicPhaseStanding {
  phaseName: string;
  phaseCode: string;
  pools: IPublicPoolStanding[];
}

export interface IPublicPoolStanding {
  poolName: string;
  teams: IPublicTeamStanding[];
}

export interface IPublicRecentResult {
  roundNumber: number;
  roundName: string;
  phaseName: string;
  leftTeam: string;
  rightTeam: string;
  leftScore: number | null;
  rightScore: number | null;
  result: 'left' | 'right' | 'tie' | 'forfeit' | 'not-played';
  overtime: boolean;
}

export interface IPublicRoundSummary {
  number: number;
  name: string;
}

export interface IPublicNextRoundAssignment {
  leftTeam: string;
  rightTeam: string;
  roomName: string;
}

export interface IPublicNextRound {
  round: IPublicRoundSummary;
  assignments: IPublicNextRoundAssignment[];
}

/** One released/current matchup on the intentionally separate public pairings page. */
export interface IPublicPairingAssignment {
  roundNumber: number;
  roundName: string;
  leftTeam: string;
  rightTeam: string;
  roomName: string;
}

/** Public pairings contain only released matchups and display names—never room credentials or state. */
export interface IPublicPairingsSnapshot {
  version: 1;
  tournamentName: string;
  lastUpdatedAt: string;
  round: IPublicRoundSummary | null;
  assignments: IPublicPairingAssignment[];
  teamNames: string[];
}

/** The complete public read-only view. It intentionally contains no IDs, tokens, sessions, or QBJ. */
export interface IPublicLiveSnapshot {
  version: 1;
  tournamentName: string;
  lastUpdatedAt: string;
  latestCompletedRound: IPublicRoundSummary | null;
  teamStandings: IPublicTeamStanding[];
  individualStandings: IPublicIndividualStanding[];
  phaseStandings: IPublicPhaseStanding[];
  recentResults: IPublicRecentResult[];
  nextRound: IPublicNextRound | null;
  settings: IPublicLiveSettings;
  metricLabels: {
    teamPpg: string;
    individualPptuh: string;
    teamPpb: string | null;
  };
}

export function makeDefaultLiveDisplaySettings(): ILiveDisplaySettings {
  return {
    enabled: defaultLiveDisplaySettings.enabled,
    publicPairingsEnabled: defaultLiveDisplaySettings.publicPairingsEnabled,
    slides: { ...defaultLiveDisplaySettings.slides },
    slideDurationSeconds: defaultLiveDisplaySettings.slideDurationSeconds,
    rowsPerSlide: defaultLiveDisplaySettings.rowsPerSlide,
    theme: defaultLiveDisplaySettings.theme,
    showLastUpdated: defaultLiveDisplaySettings.showLastUpdated,
  };
}
