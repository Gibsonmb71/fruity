/* eslint-disable no-restricted-exports */
/** Compatibility import for Fruity's room host; QBSheet owns the scoring engine. */
export { deriveGame as default } from 'qbsheet';
export {
  lastPlayedQuestion,
  lineupChangeEffectiveQuestion,
  overtimeIsSuddenDeath,
  teamsNeedingStartingLineup,
} from 'qbsheet';
export type {
  GamePeriod,
  IGameSetup,
  IDerivedBuzz,
  IDerivedGame,
  IDerivedNoPenalty,
  IDerivedPlayer,
  IDerivedProtest,
  IDerivedQuestion,
  IDerivedTeam,
  IDerivedVoid,
  ITeamSetup,
  ScoringPhase,
} from 'qbsheet';
