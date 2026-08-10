/**
 * A scheduled game written as an official QBJ assignment.
 *
 * # What replaced what
 *
 * This is what `QbsheetGamePackage` used to produce as a `.qbg`. Almost everything that format
 * carried — the tournament, the round, the teams, the rosters, the scoring rules — already had a
 * standard QBJ representation, and maintaining a second schema for them meant maintaining a second
 * parser and a second set of bugs. So an assignment is now ordinary QBJ: one `Tournament`, one
 * `Phase`, one `Round`, one unplayed `Match`, and the two teams playing it.
 *
 * Five things had no QBJ field and travel in the small `_qbtcp` extension instead: which issue of
 * the pairings this is, the room's stable id, how the room conducts the game, what to do with the
 * finished file, and whether the round is timed. See `docs/QBJ_ASSIGNMENT_PROFILE.md` in QBSheet.
 *
 * # Unplayed means unplayed
 *
 * The `Match` carries no `tossups_read`, no team points, no `match_questions`. Inventing zeroes
 * would make an assignment indistinguishable from a game that finished nil-nil, and the absence of
 * scoring content is exactly the signal an importer uses to tell the two apart.
 *
 * # One game per file, still
 *
 * A room is handed the game it is about to score and nothing else: not the standings, not the other
 * rooms, not the rounds that have not been released. Every one of those would be wrong by the end of
 * the round, and sixteen Chromebooks holding a copy of the schedule is sixteen copies a director
 * cannot correct. QBSheet can read a whole-tournament QBJ for interoperability; that is not a reason
 * for this to write one.
 *
 * # Nothing credential-shaped
 *
 * No room token, no session token, no pairing code, no device id, no server address. An assignment
 * file travels by USB stick and shared folder, and a capability that travels with it ends up
 * somewhere nobody intended. The room's credentials live in that browser's own storage.
 */
import { buildQbtcpExtension, qbjSerializationVersion, qbtcpExtensionKey, scorekeeperFormatVersion } from 'qbsheet';
import Tournament from '../DataModel/Tournament';
import { ScheduledMatch, ScheduledMatchStatus } from '../DataModel/ScheduledMatch';
import { Team } from '../DataModel/Team';
import { Player } from '../DataModel/Player';
import { camelCaseToSnakeCase } from '../DataModel/CaseConversion';
import { QbjTypeNames } from '../DataModel/QbjEnums';
import { roomProcedureIsActive } from './RoomProcedure';
import { roundAssignmentRevision } from '../../shared/RoundAssignmentRevision';

/** A QBJ object as it goes out on the wire. Deliberately loose; this is serialization. */
type QbjObject = Record<string, unknown>;

export interface IQbjAssignmentDocument {
  version: string;
  objects: QbjObject[];
}

export interface IQbjAssignment {
  scheduledMatchId: string;
  roundNumber: number;
  roundName: string;
  roomId?: string;
  roomName?: string;
  leftTeamName: string;
  rightTeamName: string;
  document: IQbjAssignmentDocument;
}

export type QbjAssignmentExport =
  | { ok: true; roundNumber: number; roundName: string; assignments: IQbjAssignment[]; problems: string[] }
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

/** The registration a team belongs to, so the document can carry the object QBJ expects. */
function registrationFor(tournament: Tournament, team: Team) {
  return tournament.registrations.find((registration) => registration.teams.some((candidate) => candidate === team));
}

/**
 * One team, with its roster, as `Team` and `Registration`.
 *
 * Built from the same `toFileObject` the tournament file uses, so an assignment and a saved
 * tournament describe a team identically — including the ids, which is what lets a result come back
 * and be matched without guessing.
 */
function teamObjects(tournament: Tournament, team: Team): { team: QbjObject; registration: QbjObject } {
  const teamObject: QbjObject = {
    type: QbjTypeNames.Team,
    id: team.id,
    name: team.name,
    // Blank rows are a real state in the desktop's roster editor and are not people.
    players: team.players
      .filter((player: Player) => player.name !== '')
      .map((player: Player) => ({ type: QbjTypeNames.Player, id: player.id, name: player.name })),
  };

  const registration = registrationFor(tournament, team);
  const registrationObject: QbjObject = {
    type: QbjTypeNames.Registration,
    id: registration ? registration.id : `Registration_${team.name}`,
    name: registration ? registration.name : team.name,
    teams: [{ $ref: team.id }],
  };

  return { team: teamObject, registration: registrationObject };
}

/**
 * Build the assignment for one scheduled game.
 *
 * @returns the document, or the reason this game cannot be exported
 */
export function buildQbjAssignment(
  tournament: Tournament,
  scheduled: ScheduledMatch,
  roundRevision: number,
): { ok: true; value: IQbjAssignment } | { ok: false; error: string } {
  if (!scheduled.roomId) return { ok: false, error: `${scheduled.describe()} has no room assignment.` };
  const room = tournament.rooms.find((candidate) => candidate.id === scheduled.roomId);
  if (!room) return { ok: false, error: `${scheduled.describe()} refers to a room that no longer exists.` };
  const round = tournament.getRoundObjByNumber(scheduled.roundNumber);
  if (!round) return { ok: false, error: `Round ${scheduled.roundNumber} could not be found.` };
  const left = tournament.findTeamByName(scheduled.leftTeamName);
  const right = tournament.findTeamByName(scheduled.rightTeamName);
  if (!left || !right) {
    return { ok: false, error: `${scheduled.describe()} refers to a team that no longer exists.` };
  }

  const phase = tournament.findPhaseByRound(round);

  const leftObjects = teamObjects(tournament, left);
  const rightObjects = teamObjects(tournament, right);

  const scoringRulesId = 'ScoringRules';
  // The tournament's own projection, so the rules a room scores under and the rules the desktop
  // holds are the same object rather than two readings of one.
  const scoringRules: QbjObject = {
    type: QbjTypeNames.ScoringRules,
    id: scoringRulesId,
    ...(tournament.scoringRules.toFileObject(true) as unknown as QbjObject),
  };

  const match: QbjObject = {
    type: QbjTypeNames.Match,
    id: scheduled.id,
    location: room.name,
    // Written in camelCase deliberately. `camelCaseToSnakeCase` assigns `match_teams = matchTeams`
    // and then deletes the camel key, so a value written straight into `match_teams` is overwritten
    // with undefined on the way out. Everything here goes through that conversion, not around it.
    matchTeams: [{ team: { $ref: left.id } }, { team: { $ref: right.id } }],
  };

  const roundObject: QbjObject = {
    type: QbjTypeNames.Round,
    id: round.id,
    // `Round.name` is the numeric string for an ordinary round; the human "Round 4" is a display
    // form and lives in the filename. An importer resolves the round from this field.
    name: round.name,
    ...(round.packet.name ? { packets: [{ name: round.packet.name }] } : {}),
    matches: [{ $ref: scheduled.id }],
  };

  const phaseObject: QbjObject = {
    type: QbjTypeNames.Phase,
    id: phase ? phase.id : 'Phase_1',
    name: phase ? phase.name : 'Playoffs',
    rounds: [roundObject],
  };

  const tournamentObject: QbjObject = {
    type: QbjTypeNames.Tournament,
    id: tournament.operationalId,
    name: tournament.name || Tournament.placeholderName,
    scoringRules: { $ref: scoringRulesId },
    registrations: [{ $ref: leftObjects.registration.id }, { $ref: rightObjects.registration.id }],
    phases: [phaseObject],
  };

  const document: IQbjAssignmentDocument = {
    version: qbjSerializationVersion,
    objects: [
      tournamentObject,
      scoringRules,
      leftObjects.registration,
      rightObjects.registration,
      leftObjects.team,
      rightObjects.team,
      match,
    ],
  };

  // The rules were built by `toFileObject`, which speaks the desktop's camelCase. Everything leaving
  // as QBJ has to be snake_case, and this is the same conversion the tournament file goes through.
  camelCaseToSnakeCase(document);

  // Attached after the conversion so the extension's own key names are never rewritten by it.
  const extension = buildQbtcpExtension({
    roundRevision,
    roomId: room.id,
    ...(roomProcedureIsActive(tournament.roomProcedure) ? { procedure: tournament.roomProcedure } : {}),
    ...(tournament.resultHandoffInstruction ? { handoffInstruction: tournament.resultHandoffInstruction } : {}),
    // The one scoring semantic QBJ has no field for. See the profile.
    scorekeeper: { timed: tournament.scoringRules.timed },
  });
  if (extension) match[qbtcpExtensionKey] = extension;

  return {
    ok: true,
    value: {
      scheduledMatchId: scheduled.id,
      roundNumber: round.number,
      roundName: round.displayName(),
      roomId: room.id,
      roomName: room.name,
      leftTeamName: left.name,
      rightTeamName: right.name,
      document,
    },
  };
}

/** Build one assignment per playable, room-assigned game in the selected released round. */
export function exportQbjAssignments(tournament: Tournament, selectedRoundNumber?: number): QbjAssignmentExport {
  const roundNumber = selectedRoundNumber ?? tournament.releasedRoundNumber;
  if (roundNumber === null || roundNumber === undefined) {
    return { ok: false, error: 'Release a round before exporting assignments.' };
  }
  if (tournament.releasedRoundNumber !== null && roundNumber > tournament.releasedRoundNumber) {
    return { ok: false, error: 'That round has not been released to room scorekeepers.' };
  }
  const round = tournament.getRoundObjByNumber(roundNumber);
  if (!round) return { ok: false, error: `Round ${roundNumber} could not be found.` };

  const revision = roundAssignmentRevision(revisionEntries(tournament), roundNumber);
  const assignments: IQbjAssignment[] = [];
  const problems: string[] = [];

  for (const scheduled of tournament.scheduledMatches.filter(
    (candidate) =>
      candidate.roundNumber === roundNumber &&
      candidate.status !== ScheduledMatchStatus.Cancelled &&
      candidate.isPlayable(),
  )) {
    const built = buildQbjAssignment(tournament, scheduled, revision);
    if (!built.ok) {
      problems.push(built.error);
      continue;
    }
    assignments.push(built.value);
  }

  if (assignments.length === 0 && problems.length > 0) return { ok: false, error: problems.join(' ') };
  return { ok: true, roundNumber, roundName: round.displayName(), assignments, problems };
}

/** Strip characters a filesystem will refuse, without inventing a name. */
function safeFilePart(value: string): string {
  const withoutControls = Array.from(value)
    .filter((character) => character.charCodeAt(0) >= 32)
    .join('');
  return (
    withoutControls
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, '-')
      .replace(/[.-]+$/g, '') || 'game'
  );
}

export function qbjAssignmentFolderName(roundName: string): string {
  return `Room Scoring — ${safeFilePart(roundName)}`;
}

/**
 * A descriptive filename, e.g. `R04_Room-204_Ninety-Six_vs_Greenwood.assignment.qbj`.
 *
 * Human guidance only. Nothing reads a filename to decide what a document is or which game it
 * belongs to — the ids inside it are the identity, which is the whole reason they are preserved.
 */
export function qbjAssignmentFileName(assignment: IQbjAssignment): string {
  const round = `R${String(Math.trunc(assignment.roundNumber)).padStart(2, '0')}`;
  const room = assignment.roomName ? `_${safeFilePart(assignment.roomName)}` : '';
  return `${round}${room}_${safeFilePart(assignment.leftTeamName)}_vs_${safeFilePart(
    assignment.rightTeamName,
  )}.assignment.qbj`;
}

/** Kept beside the builder so a caller cannot accidentally record a different descriptor version. */
export const assignmentScorekeeperFormatVersion = scorekeeperFormatVersion;
