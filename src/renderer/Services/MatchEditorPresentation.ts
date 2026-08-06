export type MatchEditorInteractionState = 'pristine' | 'editing' | 'save-attempted';

export function shouldExpandOvertime(hasExistingOvertime: boolean, explicitlyExpanded: boolean): boolean {
  return hasExistingOvertime || explicitlyExpanded;
}

export function shouldShowTiePrompt(
  isForfeit: boolean,
  leftPoints: number | undefined,
  rightPoints: number | undefined,
  expanded: boolean,
): boolean {
  return !isForfeit && !expanded && leftPoints !== undefined && rightPoints !== undefined && leftPoints === rightPoints;
}

export function isPristineNewMatch(state: MatchEditorInteractionState, hasExistingMatch: boolean): boolean {
  return state === 'pristine' && !hasExistingMatch;
}
