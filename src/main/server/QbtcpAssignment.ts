/**
 * The assignment a room is served over QBTCP, as a QBJ document.
 *
 * # Why this exists next to the renderer's builder
 *
 * `QbjAssignment` builds the same document from the renderer's `Tournament` object graph. The
 * server process does not have that graph — it has a snapshot, which is deliberately a flat,
 * serializable projection with no classes and no getters in it. So the document is assembled twice
 * from two different inputs, and the risk that creates is the one this whole migration exists to
 * remove: two producers of one format drifting apart.
 *
 * Three things keep them together, and all three are load-bearing:
 *
 *   - The ids are *derived the same way*, not invented. `Team_${name}` is exactly what
 *     `Team.id` returns in the renderer, and player ids are carried through the snapshot rather
 *     than recomputed here, because `Player.id` includes a counter this process cannot see.
 *   - The scoring rules are written by QBSheet's own `writeQbjScoringRules`, which is the inverse of
 *     the reader the room will use. Neither side hand-rolls the mapping.
 *   - A contract test opens both documents with the same parser and asserts the resulting
 *     `GameDefinition`s agree.
 *
 * # No credentials, same as the file
 *
 * The room token that authorized this request does not appear in what it returns. An assignment is
 * the least controlled object a tournament produces and a capability travelling inside one ends up
 * somewhere nobody intended.
 */
import {
  buildQbtcpExtension,
  qbjSerializationVersion,
  qbtcpExtensionKey,
  writeQbjScoringRules,
  type IScorekeeperFormat,
} from 'qbsheet';
import { IRoomMatchup, IRoomTeam, ITournamentSnapshot } from './ServerTypes';

type QbjObject = Record<string, unknown>;

export interface IQbtcpAssignmentDocument {
  version: string;
  objects: QbjObject[];
}

/**
 * The renderer's `Team.id`, derived rather than transmitted.
 *
 * Kept identical to `Team.id` in the data model. If that ever changes, this has to change with it,
 * and the contract test is what will say so.
 */
function teamId(name: string): string {
  return `Team_${name}`;
}

/**
 * The registration, preferring the real one the snapshot carries.
 *
 * Derivation is a fallback, not the rule: a registration is an *organization*, and an organization
 * that fields an A and a B team registers once. `Registration_${teamName}` would name a
 * registration that does not exist, and a result carrying it would point at nothing. The derived
 * form is kept only for a snapshot written before this field existed, where a plausible id is
 * better than none.
 */
function registrationOf(team: IRoomTeam): { id: string; name: string } {
  return team.registration ?? { id: `Registration_${team.name}`, name: team.name };
}

function teamObjects(team: IRoomTeam): { team: QbjObject; registration: QbjObject } {
  return {
    team: {
      type: 'Team',
      id: teamId(team.name),
      name: team.name,
      players: team.players.map((player) => ({
        type: 'Player',
        // Carried through the snapshot: `Player.id` includes a per-player counter the server has no
        // way to reproduce, and a guessed id is worse than none.
        ...(player.id ? { id: player.id } : {}),
        name: player.name,
      })),
    },
    registration: {
      type: 'Registration',
      ...registrationOf(team),
      teams: [{ $ref: teamId(team.name) }],
    },
  };
}

/**
 * `Round.name` as the schema wants it.
 *
 * The snapshot carries the round's *display* name ("Round 4", "Finals"). QBJ wants the bare number
 * for an ordinary round, because that is what the reference importer resolves rounds by. A round
 * whose display name is not simply its number keeps its name.
 */
function roundName(matchup: IRoomMatchup): string {
  const numeric = String(matchup.roundNumber);
  return matchup.roundName === `Round ${numeric}` || matchup.roundName === numeric ? numeric : matchup.roundName;
}

export interface IQbtcpAssignmentInput {
  snapshot: ITournamentSnapshot;
  matchup: IRoomMatchup;
  roomId: string;
  roomName: string;
  format: IScorekeeperFormat;
}

/** Build the QBJ document for the game a room should be scoring now. */
export function buildQbtcpAssignmentDocument(input: IQbtcpAssignmentInput): IQbtcpAssignmentDocument {
  const { snapshot, matchup, roomId, roomName, format } = input;

  const left = teamObjects(matchup.leftTeam);
  const right = teamObjects(matchup.rightTeam);

  const scoringRulesId = 'ScoringRules';
  const scoringRules = writeQbjScoringRules(format, scoringRulesId);

  const match: QbjObject = {
    type: 'Match',
    id: matchup.scheduledMatchId,
    location: roomName,
    // Unplayed. No scores, no questions: see the note in the renderer's builder.
    match_teams: [
      { team: { $ref: teamId(matchup.leftTeam.name) } },
      { team: { $ref: teamId(matchup.rightTeam.name) } },
    ],
  };

  const extension = buildQbtcpExtension({
    roundRevision: matchup.roundRevision,
    roomId,
    ...(snapshot.roomProcedure ? { procedure: snapshot.roomProcedure } : {}),
    ...(snapshot.resultHandoffInstruction ? { handoffInstruction: snapshot.resultHandoffInstruction } : {}),
    scorekeeper: { timed: format.regulation.timed },
  });
  if (extension) match[qbtcpExtensionKey] = extension;

  const round: QbjObject = {
    type: 'Round',
    id: `Round_${roundName(matchup)}`,
    name: roundName(matchup),
    ...(matchup.packetName ? { packets: [{ name: matchup.packetName }] } : {}),
    matches: [{ $ref: matchup.scheduledMatchId }],
  };

  // The real phase where the snapshot knows it. A playoff game that claimed the prelim phase would
  // be filed under the wrong bracket coming back. The name is omitted rather than invented when the
  // snapshot cannot say, which is the same thing the renderer's builder does.
  const phase: QbjObject = {
    type: 'Phase',
    id: matchup.phaseName ? `Phase_${matchup.phaseName}` : 'Phase_1',
    ...(matchup.phaseName ? { name: matchup.phaseName } : {}),
    rounds: [round],
  };

  const tournament: QbjObject = {
    type: 'Tournament',
    ...(snapshot.recoveryKey ? { id: snapshot.recoveryKey } : {}),
    name: snapshot.name,
    scoring_rules: { $ref: scoringRulesId },
    registrations: [{ $ref: left.registration.id as string }, { $ref: right.registration.id as string }],
    phases: [phase],
  };

  return {
    version: qbjSerializationVersion,
    // Already snake_case: this process writes QBJ directly and never runs the renderer's case
    // conversion, so nothing here may be spelled in camelCase.
    objects: [tournament, scoringRules, left.registration, right.registration, left.team, right.team, match],
  };
}
