import { ApplicationPages, ControlPages, SetupPages } from '../Enums';
import { ReadinessTarget } from './TournamentReadiness';

export interface INavigationPreferences {
  activePage: ApplicationPages;
  setupSection: SetupPages;
  controlSection: ControlPages;
}

export interface INavigationFallbackState {
  coreReady: boolean;
  roomOperationsEnabled: boolean;
  currentRoundNumber: number | null;
  hasMatches: boolean;
  hasScheduledMatches: boolean;
  tournamentComplete: boolean;
}

export const defaultNavigationPreferences: INavigationPreferences = {
  activePage: ApplicationPages.Setup,
  setupSection: SetupPages.Tournament,
  controlSection: ControlPages.Live,
};

export function navigationStorageKey(identity: string): string {
  return `yellowfruit.navigation.v1.${identity || 'new-tournament'}`;
}

function isEnumValue<T extends Record<string, string | number>>(value: unknown, enumObject: T): value is T[keyof T] {
  return Object.values(enumObject).includes(value as T[keyof T]);
}

export function readNavigationPreferences(identity: string): INavigationPreferences | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const parsed = JSON.parse(
      localStorage.getItem(navigationStorageKey(identity)) ?? 'null',
    ) as Partial<INavigationPreferences>;
    if (!parsed || !isEnumValue(parsed.activePage, ApplicationPages)) return null;
    if (!isEnumValue(parsed.setupSection, SetupPages) || !isEnumValue(parsed.controlSection, ControlPages)) return null;
    return {
      activePage: parsed.activePage,
      setupSection: parsed.setupSection,
      controlSection: parsed.controlSection,
    };
  } catch (err: any) {
    return null;
  }
}

export function writeNavigationPreferences(identity: string, preferences: INavigationPreferences) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(navigationStorageKey(identity), JSON.stringify(preferences));
  } catch (err: any) {
    // Navigation state is a convenience only; a full or unavailable storage must not affect editing.
  }
}

export function fallbackNavigationPreferences(state: INavigationFallbackState): INavigationPreferences {
  if (!state.coreReady) return defaultNavigationPreferences;
  if (state.tournamentComplete) return { ...defaultNavigationPreferences, activePage: ApplicationPages.Reports };
  if (state.roomOperationsEnabled && state.currentRoundNumber !== null) {
    return { ...defaultNavigationPreferences, activePage: ApplicationPages.Control, controlSection: ControlPages.Live };
  }
  if (state.hasMatches && !state.roomOperationsEnabled) {
    return { ...defaultNavigationPreferences, activePage: ApplicationPages.Games };
  }
  if (state.hasScheduledMatches && state.roomOperationsEnabled) {
    return {
      ...defaultNavigationPreferences,
      activePage: ApplicationPages.Control,
      controlSection: ControlPages.MatchPlan,
    };
  }
  return defaultNavigationPreferences;
}

export function targetForPreferences(preferences: INavigationPreferences): ReadinessTarget {
  if (preferences.activePage === ApplicationPages.Games) return 'games';
  if (preferences.activePage === ApplicationPages.Reports) return 'reports';
  if (preferences.activePage === ApplicationPages.Control) {
    if (preferences.controlSection === ControlPages.MatchPlan) return 'control:match-plan';
    if (preferences.controlSection === ControlPages.Rooms) return 'control:rooms';
    if (preferences.controlSection === ControlPages.Display) return 'control:display';
    return 'control:live';
  }
  switch (preferences.setupSection) {
    case SetupPages.Rules:
      return 'setup:rules';
    case SetupPages.Teams:
      return 'setup:teams';
    case SetupPages.Format:
      return 'setup:format';
    case SetupPages.Tournament:
    default:
      return 'setup:tournament';
  }
}
