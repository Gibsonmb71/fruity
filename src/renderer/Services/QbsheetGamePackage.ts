/**
 * Fruity's adapter from its tournament model to the canonical QBSheet game-file contract.
 *
 * This module owns only the desktop-side scheduling/export translation. The package shape,
 * validation, scoring rules and producer identity come from QBSheet.
 */
import {
  gamePackageFormat as qbsheetFormat,
  gamePackageProducer,
  gamePackageVersion as qbsheetVersion,
  type IGamePackage,
  type IGamePackageTeam,
} from 'qbsheet';
import { ScheduledMatch, ScheduledMatchStatus } from '../DataModel/ScheduledMatch';
import Tournament from '../DataModel/Tournament';
import scoringRulesToScorekeeperFormat from './ScorekeeperFormat';
import { roomProcedureIsActive } from './RoomProcedure';
import { roundAssignmentRevision } from '../../shared/RoundAssignmentRevision';

export const qbsheetGamePackageFormat = qbsheetFormat;
export const qbsheetGamePackageVersion = qbsheetVersion;
export type IQbsheetPackageRoster = IGamePackageTeam;
export type IQbsheetGamePackage = IGamePackage;

export type QbsheetGamePackageExport =
  | { ok: true; roundNumber: number; roundName: string; packages: IQbsheetGamePackage[]; problems: string[] }
  | { ok: false; error: string };

function revisionEntries(tournament: Tournament) {
  return tournament.scheduledMatches.map((match) => ({
    scheduledMatchId: match.id,
    roundNumber: match.roundNumber,
    leftTeam: match.leftTeamName,
    rightTeam: match.rightTeamName,
    roomId: match.roomId,
    status: match.status,
  }));
}

function rosterFor(tournament: Tournament, teamName: string): IQbsheetPackageRoster | null {
  const team = tournament.findTeamByName(teamName);
  if (!team) return null;
  return {
    name: team.name,
    players: team.players.filter((player) => player.name !== '').map((player) => ({ name: player.name })),
  };
}

function packageFor(
  tournament: Tournament,
  scheduled: ScheduledMatch,
  roundRevision: number,
): { ok: true; value: IQbsheetGamePackage } | { ok: false; error: string } {
  if (!scheduled.roomId) return { ok: false, error: `${scheduled.describe()} has no room assignment.` };
  const room = tournament.rooms.find((candidate) => candidate.id === scheduled.roomId);
  if (!room) return { ok: false, error: `${scheduled.describe()} refers to a room that no longer exists.` };
  const round = tournament.getRoundObjByNumber(scheduled.roundNumber);
  if (!round) return { ok: false, error: `Round ${scheduled.roundNumber} could not be found.` };
  const left = rosterFor(tournament, scheduled.leftTeamName);
  const right = rosterFor(tournament, scheduled.rightTeamName);
  if (!left || !right) return { ok: false, error: `${scheduled.describe()} refers to a team that no longer exists.` };

  const value: IQbsheetGamePackage = {
    format: qbsheetGamePackageFormat,
    version: qbsheetGamePackageVersion,
    producer: gamePackageProducer,
    tournament: {
      key: tournament.operationalId,
      name: tournament.name || Tournament.placeholderName,
    },
    scheduledMatchId: scheduled.id,
    round: {
      number: round.number,
      name: round.displayName(),
      revision: roundRevision,
      ...(round.packet.name ? { packetName: round.packet.name } : {}),
    },
    room: { id: room.id, name: room.name },
    left,
    right,
    scorekeeperFormat: scoringRulesToScorekeeperFormat(tournament.scoringRules),
    ...(roomProcedureIsActive(tournament.roomProcedure) ? { procedure: tournament.roomProcedure } : {}),
    ...(tournament.resultHandoffInstruction ? { handoffInstruction: tournament.resultHandoffInstruction } : {}),
  };
  return { ok: true, value };
}

/** Build one package per playable, room-assigned game in the selected released round. */
export function exportQbsheetGamePackages(
  tournament: Tournament,
  selectedRoundNumber?: number,
): QbsheetGamePackageExport {
  const roundNumber = selectedRoundNumber ?? tournament.releasedRoundNumber;
  if (roundNumber === null || roundNumber === undefined) {
    return { ok: false, error: 'Release a round before exporting QBSheet game files.' };
  }
  if (tournament.releasedRoundNumber !== null && roundNumber > tournament.releasedRoundNumber) {
    return { ok: false, error: 'That round has not been released to room scorekeepers.' };
  }
  const round = tournament.getRoundObjByNumber(roundNumber);
  if (!round) return { ok: false, error: `Round ${roundNumber} could not be found.` };

  const revision = roundAssignmentRevision(revisionEntries(tournament), roundNumber);
  const packages: IQbsheetGamePackage[] = [];
  const problems: string[] = [];
  for (const scheduled of tournament.scheduledMatches.filter(
    (candidate) =>
      candidate.roundNumber === roundNumber &&
      candidate.status !== ScheduledMatchStatus.Cancelled &&
      candidate.isPlayable(),
  )) {
    const built = packageFor(tournament, scheduled, revision);
    if (!built.ok) {
      problems.push(built.error);
      continue;
    }
    packages.push(built.value);
  }
  if (packages.length === 0 && problems.length > 0) return { ok: false, error: problems.join(' ') };
  return { ok: true, roundNumber, roundName: round.displayName(), packages, problems };
}

function safeFilePart(value: string): string {
  const withoutControls = Array.from(value)
    .filter((character) => character.charCodeAt(0) >= 32)
    .join('');
  return (
    withoutControls
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, ' ')
      .replace(/[. ]+$/g, '') || 'unnamed'
  );
}

export function qbsheetGamePackageFolderName(roundName: string): string {
  return `Room Scoring — ${safeFilePart(roundName)}`;
}

export function qbsheetGamePackageFileName(packageValue: IQbsheetGamePackage): string {
  return `${safeFilePart(packageValue.round.name)} — ${safeFilePart(packageValue.left.name)} vs ${safeFilePart(
    packageValue.right.name,
  )}.qbg`;
}
