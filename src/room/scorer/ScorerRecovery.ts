/** Compatibility import for Fruity's room host; QBSheet owns the recovery payload contract. */
export {
  attachScorerRecovery,
  readScorerRecovery,
  validEvent,
  validSetup,
  scorerRecoveryKey,
  scorerRecoveryVersion,
} from 'qbsheet';
export type { IScorerRecoveryPayload } from 'qbsheet';
