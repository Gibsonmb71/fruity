import { describe, expect, test, vi } from 'vitest';
import { dispatchReadinessAction, dispatchTournamentAction } from '../renderer/Services/TournamentActions';
import type { ITournamentReadiness } from '../renderer/Services/TournamentReadiness';

function readiness(kind: 'start-server' | 'release-round' | 'review-results' | 'open-rebracket'): ITournamentReadiness {
  return { primaryAction: { kind, label: kind }, coreReady: true } as ITournamentReadiness;
}

describe('central tournament action dispatch', () => {
  test('does not execute a stale release capability', () => {
    const release = vi.fn();
    const action = { kind: 'release-round' as const, label: 'Release', roundNumber: 2 };

    expect(
      dispatchReadinessAction(action, readiness('release-round'), {
        canReleaseRound: () => false,
        onReleaseRound: release,
      }),
    ).toBe(false);
    expect(release).not.toHaveBeenCalled();
  });

  test('Quick Find and the primary action share the release authority', () => {
    const release = vi.fn();
    const action = {
      target: 'control:live' as const,
      actionId: 'release-round',
      roundNumber: 2,
    };
    const result = dispatchTournamentAction(action, readiness('release-round'), {
      canReleaseRound: (roundNumber) => roundNumber === 2,
      onReleaseRound: release,
    });

    expect(result).toBe(true);
    expect(release).toHaveBeenCalledWith(2);
  });

  test('review and rebracket commands only perform their safe centralized effects', () => {
    const review = vi.fn();
    const rebracket = vi.fn();

    expect(
      dispatchReadinessAction({ kind: 'review-results', label: 'Review' }, readiness('review-results'), {
        onReviewResults: review,
      }),
    ).toBe(true);
    expect(
      dispatchReadinessAction({ kind: 'open-rebracket', label: 'Rebracket' }, readiness('open-rebracket'), {
        onOpenRebracket: rebracket,
      }),
    ).toBe(true);
    expect(review).toHaveBeenCalledOnce();
    expect(rebracket).toHaveBeenCalledOnce();
  });
});
