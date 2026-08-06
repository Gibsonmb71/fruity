import { describe, expect, test } from 'vitest';
import { ApplicationPages, ControlPages, SetupPages } from '../renderer/Enums';
import {
  defaultNavigationPreferences,
  fallbackNavigationPreferences,
  navigationStorageKey,
} from '../renderer/Services/NavigationPreferences';

describe('navigation preferences', () => {
  test('uses setup when core configuration is incomplete', () => {
    expect(
      fallbackNavigationPreferences({
        coreReady: false,
        roomOperationsEnabled: false,
        currentRoundNumber: null,
        hasMatches: false,
        hasScheduledMatches: false,
        tournamentComplete: false,
      }),
    ).toEqual(defaultNavigationPreferences);
  });

  test('resumes the useful operational surface for each workflow', () => {
    expect(
      fallbackNavigationPreferences({
        coreReady: true,
        roomOperationsEnabled: false,
        currentRoundNumber: null,
        hasMatches: true,
        hasScheduledMatches: false,
        tournamentComplete: false,
      }).activePage,
    ).toBe(ApplicationPages.Games);
    expect(
      fallbackNavigationPreferences({
        coreReady: true,
        roomOperationsEnabled: true,
        currentRoundNumber: 2,
        hasMatches: false,
        hasScheduledMatches: true,
        tournamentComplete: false,
      }),
    ).toMatchObject({ activePage: ApplicationPages.Control, controlSection: ControlPages.Live });
    expect(
      fallbackNavigationPreferences({
        coreReady: true,
        roomOperationsEnabled: true,
        currentRoundNumber: null,
        hasMatches: false,
        hasScheduledMatches: true,
        tournamentComplete: false,
      }),
    ).toMatchObject({ activePage: ApplicationPages.Control, controlSection: ControlPages.MatchPlan });
  });

  test('uses a namespaced storage key and reports finish at Reports', () => {
    expect(navigationStorageKey('/tmp/example.yft')).toBe('yellowfruit.navigation.v1./tmp/example.yft');
    expect(
      fallbackNavigationPreferences({
        coreReady: true,
        roomOperationsEnabled: false,
        currentRoundNumber: null,
        hasMatches: true,
        hasScheduledMatches: false,
        tournamentComplete: true,
      }),
    ).toMatchObject({ activePage: ApplicationPages.Reports, setupSection: SetupPages.Tournament });
  });
});
