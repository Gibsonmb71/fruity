import { Match } from '../DataModel/Match';
import { Phase } from '../DataModel/Phase';
import { ScheduledMatch, ScheduledMatchStatus } from '../DataModel/ScheduledMatch';
import Tournament from '../DataModel/Tournament';
import { TournamentRoom } from '../DataModel/TournamentRoom';
import { randomId } from '../Utils/RandomIds';

/**
 * Diagnostics produced while loading the YellowFruit-only operational projection.
 *
 * QBJ parsing remains responsible for the tournament's canonical object graph. This service is a
 * deliberately small, deterministic pass over the room/schedule metadata that QBJ does not know
 * about. It is used both after imports and before a server snapshot is published, so malformed
 * scheduling state cannot quietly become playable.
 */
export interface IOperationalIntegrityResult {
  diagnostics: string[];
  repaired: boolean;
  /** True when the file is readable but still needs director review before room scoring. */
  requiresReview: boolean;
}

const terminalStatuses = new Set([ScheduledMatchStatus.Accepted, ScheduledMatchStatus.Cancelled]);

function isTerminal(match: ScheduledMatch): boolean {
  return terminalStatuses.has(match.status);
}

function allMatches(tournament: Tournament): Match[] {
  return tournament.phases.flatMap((phase) => phase.getAllMatches());
}

function phaseFor(tournament: Tournament, scheduled: ScheduledMatch): Phase | undefined {
  return tournament.whichPhaseIsRoundNumberIn(scheduled.roundNumber);
}

function markReviewOnly(scheduled: ScheduledMatch, reason: string, result: IOperationalIntegrityResult) {
  if (!scheduled.quarantined) {
    scheduled.quarantined = true;
    result.repaired = true;
  }
  if (scheduled.operationalIssue !== reason) {
    scheduled.operationalIssue = reason;
    result.repaired = true;
  }
  // Accepted/Cancelled are terminal and must stay terminal even when their persisted linkage is
  // damaged. They are not playable, so quarantine is enough to prevent a dangerous repair.
  if (!isTerminal(scheduled) && scheduled.status !== ScheduledMatchStatus.NeedsAttention) {
    scheduled.status = ScheduledMatchStatus.NeedsAttention;
    result.repaired = true;
  }
  result.requiresReview = true;
  result.diagnostics.push(`${scheduled.describe()}: ${reason}`);
}

function freshUniqueRoomId(existing: Set<string>): string {
  let id = TournamentRoom.generateId();
  while (existing.has(id)) id = TournamentRoom.generateId();
  return id;
}

function freshUniqueScheduleId(existing: Set<string>): string {
  let id = randomId('sched');
  while (existing.has(id)) id = randomId('sched');
  return id;
}

/**
 * Validate and conservatively repair operational metadata in place.
 *
 * The repair policy is intentionally asymmetric: harmless identity omissions are repaired, while
 * ambiguous history is quarantined. A malformed file must never be made playable by guessing which
 * room, result, or pairing the author intended.
 */
export function repairOperationalIntegrity(tournament: Tournament): IOperationalIntegrityResult {
  const result: IOperationalIntegrityResult = { diagnostics: [], repaired: false, requiresReview: false };
  const roomIds = new Set<string>();
  const roomTokens = new Set<string>();
  const ambiguousRoomIds = new Set<string>();
  const knownRounds = new Set(tournament.phases.flatMap((phase) => phase.rounds.map((round) => round.number)));

  const roomOrder = tournament.rooms.map((room) => room.id);
  tournament.rooms.sort(TournamentRoom.compare);
  if (roomOrder.some((id, index) => id !== tournament.rooms[index]?.id)) {
    result.repaired = true;
    result.diagnostics.push('Room order was normalized for deterministic assignment behavior.');
  }

  for (const room of tournament.rooms) {
    if (!room.id.trim()) {
      room.id = freshUniqueRoomId(roomIds);
      result.repaired = true;
      result.requiresReview = true;
      result.diagnostics.push(`A room with no usable id was assigned ${room.id}.`);
    } else if (roomIds.has(room.id)) {
      const oldId = room.id;
      ambiguousRoomIds.add(oldId);
      room.id = freshUniqueRoomId(roomIds);
      result.repaired = true;
      result.requiresReview = true;
      result.diagnostics.push(`Duplicate room id ${oldId} was regenerated for ${room.name || room.id}.`);
    }
    roomIds.add(room.id);
    if (!room.accessToken.trim()) {
      room.regenerateToken();
      result.repaired = true;
      result.requiresReview = true;
      result.diagnostics.push(`A usable access token was generated for room ${room.name || room.id}.`);
    } else if (roomTokens.has(room.accessToken)) {
      room.regenerateToken();
      while (roomTokens.has(room.accessToken)) room.regenerateToken();
      result.repaired = true;
      result.requiresReview = true;
      result.diagnostics.push(`Duplicate access token was regenerated for room ${room.name || room.id}.`);
    }
    roomTokens.add(room.accessToken);

    if (room.availableRoundNumbers) {
      const originalAvailability = room.availableRoundNumbers.slice();
      room.availableRoundNumbers = Array.from(
        new Set(
          room.availableRoundNumbers.filter(
            (roundNumber) => Number.isInteger(roundNumber) && knownRounds.has(roundNumber),
          ),
        ),
      ).sort((left, right) => left - right);
      if (
        originalAvailability.length !== room.availableRoundNumbers.length ||
        originalAvailability.some((roundNumber, index) => roundNumber !== room.availableRoundNumbers?.[index])
      ) {
        result.repaired = true;
        result.diagnostics.push(`Room ${room.name || room.id} availability was normalized to valid rounds.`);
      }
    }
  }

  const scheduleIds = new Set<string>();
  for (const scheduled of tournament.scheduledMatches) {
    if (scheduleIds.has(scheduled.id)) {
      const oldId = scheduled.id;
      scheduled.id = freshUniqueScheduleId(scheduleIds);
      result.repaired = true;
      result.requiresReview = true;
      result.diagnostics.push(`Duplicate scheduled-match id ${oldId} was regenerated.`);
      markReviewOnly(scheduled, 'Its scheduled-match id was duplicated in the file.', result);
    }
    scheduleIds.add(scheduled.id);
  }

  const matches = allMatches(tournament);
  const matchesById = new Map<string, Match>();
  const duplicateMatchIds = new Set<string>();
  for (const match of matches) {
    const existing = matchesById.get(match.id);
    if (existing && existing !== match) {
      duplicateMatchIds.add(match.id);
      result.requiresReview = true;
      result.diagnostics.push(`Duplicate official Match id ${match.id} was found; scheduled links need review.`);
    } else {
      matchesById.set(match.id, match);
    }
  }

  const resultOwners = new Map<string, ScheduledMatch>();
  for (const scheduled of tournament.scheduledMatches) {
    const round = tournament.getRoundObjByNumber(scheduled.roundNumber);
    const phase = phaseFor(tournament, scheduled);

    const phaseByCode = tournament.phases.find((candidate) => candidate.code === scheduled.phaseCode);
    if (phaseByCode && phase && phaseByCode !== phase) {
      result.requiresReview = true;
      result.diagnostics.push(`${scheduled.describe()}: its phase code disagreed with its round and was corrected.`);
    }

    if (!round) {
      if (!isTerminal(scheduled)) markReviewOnly(scheduled, 'Its round does not exist in this tournament.', result);
      else {
        result.requiresReview = true;
        result.diagnostics.push(`${scheduled.describe()}: its historical round does not exist.`);
      }
    }

    if (!phase) {
      if (!isTerminal(scheduled)) markReviewOnly(scheduled, 'Its phase could not be resolved.', result);
      else {
        result.requiresReview = true;
        result.diagnostics.push(`${scheduled.describe()}: its historical phase could not be resolved.`);
      }
    } else {
      if (scheduled.phaseCode !== phase.code) {
        scheduled.phaseCode = phase.code;
        result.repaired = true;
        result.diagnostics.push(`${scheduled.describe()}: phase reference was normalized to ${phase.code}.`);
      }
      if (scheduled.poolName && !phase.pools.some((pool) => pool.name === scheduled.poolName)) {
        if (!isTerminal(scheduled)) markReviewOnly(scheduled, 'Its pool reference does not exist.', result);
        else {
          result.requiresReview = true;
          result.diagnostics.push(`${scheduled.describe()}: its historical pool reference does not exist.`);
        }
      }
    }

    if (scheduled.roomId && ambiguousRoomIds.has(scheduled.roomId)) {
      if (!isTerminal(scheduled)) scheduled.roomId = undefined;
      markReviewOnly(scheduled, 'Its room id was duplicated, so the intended room is ambiguous.', result);
    } else if (scheduled.roomId && !roomIds.has(scheduled.roomId)) {
      if (!isTerminal(scheduled)) {
        scheduled.roomId = undefined;
        result.repaired = true;
        markReviewOnly(scheduled, 'Its room reference does not exist; the assignment was removed.', result);
      } else {
        result.requiresReview = true;
        result.diagnostics.push(`${scheduled.describe()}: its historical room reference does not exist.`);
      }
    }

    const leftExists = tournament.findTeamByName(scheduled.leftTeamName) !== undefined;
    const rightExists = tournament.findTeamByName(scheduled.rightTeamName) !== undefined;
    if (!leftExists || !rightExists || scheduled.leftTeamName === scheduled.rightTeamName) {
      const reason = !leftExists || !rightExists ? 'one or both teams do not exist' : 'both sides name the same team';
      if (!isTerminal(scheduled)) markReviewOnly(scheduled, `Its pairing is invalid: ${reason}.`, result);
      else {
        result.requiresReview = true;
        result.diagnostics.push(`${scheduled.describe()}: its historical pairing is invalid (${reason}).`);
      }
    }

    if (scheduled.status === ScheduledMatchStatus.Accepted) {
      if (!scheduled.resultMatchId) {
        markReviewOnly(scheduled, 'It is marked accepted but has no result Match link.', result);
      } else {
        const linked = matchesById.get(scheduled.resultMatchId);
        const priorOwner = resultOwners.get(scheduled.resultMatchId);
        if (duplicateMatchIds.has(scheduled.resultMatchId)) {
          markReviewOnly(scheduled, 'Its accepted result id is not unique among official Matches.', result);
        } else if (!linked) {
          markReviewOnly(scheduled, 'Its accepted result link does not point to an official Match.', result);
        } else if (priorOwner && priorOwner !== scheduled) {
          markReviewOnly(scheduled, 'Its accepted result is already linked from another scheduled match.', result);
          result.requiresReview = true;
          result.diagnostics.push(`${priorOwner.describe()}: its result link is duplicated.`);
        } else {
          resultOwners.set(scheduled.resultMatchId, scheduled);
          const linkedRound = tournament.getRoundOfMatch(linked);
          const linkedTeams = [linked.leftTeam.team?.name, linked.rightTeam.team?.name];
          if (
            !linkedRound ||
            linkedRound.number !== scheduled.roundNumber ||
            linkedTeams[0] === undefined ||
            linkedTeams[1] === undefined ||
            !scheduled.matchesTeams(linkedTeams[0], linkedTeams[1])
          ) {
            markReviewOnly(scheduled, 'Its accepted result link does not match its round or teams.', result);
          }
        }
      }
    } else if (scheduled.resultMatchId) {
      const oldLink = scheduled.resultMatchId;
      scheduled.resultMatchId = undefined;
      result.repaired = true;
      markReviewOnly(
        scheduled,
        `It had a result link while ${scheduled.status}; the link ${oldLink} was removed.`,
        result,
      );
    }
  }

  // A non-cancelled team or room may occupy only one slot in a round. Quarantine every ambiguous
  // non-terminal entry so the repair never silently chooses a winner.
  const byRound = new Map<number, ScheduledMatch[]>();
  for (const scheduled of tournament.scheduledMatches) {
    if (scheduled.status === ScheduledMatchStatus.Cancelled) continue;
    const list = byRound.get(scheduled.roundNumber) ?? [];
    list.push(scheduled);
    byRound.set(scheduled.roundNumber, list);
  }
  for (const [roundNumber, scheduledMatches] of byRound) {
    const teamOwners = new Map<string, ScheduledMatch>();
    const roomOwners = new Map<string, ScheduledMatch>();
    for (const scheduled of scheduledMatches) {
      for (const teamName of [scheduled.leftTeamName, scheduled.rightTeamName]) {
        const prior = teamOwners.get(teamName);
        if (prior && prior !== scheduled) {
          const reason = `Round ${roundNumber} schedules ${teamName} more than once; both games need review.`;
          if (!isTerminal(scheduled)) markReviewOnly(scheduled, reason, result);
          if (!isTerminal(prior)) markReviewOnly(prior, reason, result);
          else result.requiresReview = true;
        } else {
          teamOwners.set(teamName, scheduled);
        }
      }
      if (scheduled.roomId) {
        const prior = roomOwners.get(scheduled.roomId);
        if (prior && prior !== scheduled) {
          const reason = `Round ${roundNumber} assigns room ${scheduled.roomId} more than once; both games need review.`;
          if (!isTerminal(scheduled)) markReviewOnly(scheduled, reason, result);
          if (!isTerminal(prior)) markReviewOnly(prior, reason, result);
          else result.requiresReview = true;
        } else {
          roomOwners.set(scheduled.roomId, scheduled);
        }
      }
    }
  }

  const rounds = knownRounds;
  if (tournament.releasedRoundNumber !== null && !rounds.has(tournament.releasedRoundNumber)) {
    result.diagnostics.push(`Released round ${tournament.releasedRoundNumber} does not exist and was cleared.`);
    tournament.releasedRoundNumber = null;
    result.repaired = true;
    result.requiresReview = true;
  } else if (
    tournament.releasedRoundNumber !== null &&
    !tournament.scheduledMatches.some(
      (scheduled) =>
        scheduled.roundNumber === tournament.releasedRoundNumber && scheduled.status !== ScheduledMatchStatus.Cancelled,
    )
  ) {
    result.diagnostics.push(
      `Released round ${tournament.releasedRoundNumber} had no playable scheduled games and was cleared.`,
    );
    tournament.releasedRoundNumber = null;
    result.repaired = true;
    result.requiresReview = true;
  }
  const phaseCodes = new Set(tournament.phases.map((phase) => phase.code));
  const uniquePhaseCodes = Array.from(new Set(tournament.rebracketedPhaseCodes.filter((code) => phaseCodes.has(code))));
  if (
    uniquePhaseCodes.length !== tournament.rebracketedPhaseCodes.length ||
    uniquePhaseCodes.some((code, index) => code !== tournament.rebracketedPhaseCodes[index])
  ) {
    tournament.rebracketedPhaseCodes = uniquePhaseCodes;
    result.repaired = true;
    result.diagnostics.push('Unknown rebracketing checkpoints were removed.');
  }

  return result;
}

/** A read-only validation entry point for callers that only need diagnostics. */
export function inspectOperationalIntegrity(tournament: Tournament): IOperationalIntegrityResult {
  // The operational pass is deterministic, but callers asking only for inspection must not mutate
  // the model. Clone only the small operational projection; the validator reads the canonical
  // phases, teams, and official matches without changing them.
  const copy = Object.assign(Object.create(Object.getPrototypeOf(tournament)), tournament) as Tournament;
  copy.rooms = tournament.rooms.map((room) => Object.assign(Object.create(Object.getPrototypeOf(room)), room));
  copy.scheduledMatches = tournament.scheduledMatches.map((scheduled) =>
    Object.assign(Object.create(Object.getPrototypeOf(scheduled)), scheduled),
  );
  copy.rebracketedPhaseCodes = tournament.rebracketedPhaseCodes.slice();
  return repairOperationalIntegrity(copy);
}
