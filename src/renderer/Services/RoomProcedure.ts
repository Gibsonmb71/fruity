/** Compatibility import for Fruity's model and room host; QBSheet owns procedure semantics. */
export {
  defaultRoomProcedure,
  isKnownRoomProcedureVersion,
  lineupChangeAllowedAtPhase,
  maximumHalfLengthMinutes,
  maximumTimeoutDurationSeconds,
  maximumTimeoutsPerTeam,
  protestBlocksCheckpoint,
  protestBlocksSuddenDeathTossup,
  protestCheckpointPolicy,
  readRoomProcedure,
  roomProcedureIsActive,
  roomProcedureVersion,
  substitutionPolicy,
} from 'qbsheet';
export type { IRoomProcedure, ProtestCheckpointPolicy, SubstitutionPolicy } from 'qbsheet';
