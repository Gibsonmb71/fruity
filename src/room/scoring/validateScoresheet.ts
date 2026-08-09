/* eslint-disable no-restricted-exports */
/** Compatibility import for Fruity's room host; QBSheet owns scoresheet validation. */
export { validateScoresheet as default } from 'qbsheet';
export { effectiveQuestionEvents, validateCorrectedHistory } from 'qbsheet';
export type { IScoresheetProblem, IScoresheetValidation, ScoresheetProblemSeverity } from 'qbsheet';
