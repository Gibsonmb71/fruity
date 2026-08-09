/* eslint-disable no-restricted-exports */
/** Compatibility import for Fruity's room host; QBSheet owns score-event validation. */
export { canApplyScoreEvent as default } from 'qbsheet';
export { applyScoreEvents } from 'qbsheet';
export type { IScoreEventContext, ScoreEventVerdict } from 'qbsheet';
