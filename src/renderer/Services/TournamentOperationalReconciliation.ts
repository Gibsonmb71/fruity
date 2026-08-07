import { Match } from '../DataModel/Match';
import { ScheduledMatchStatus } from '../DataModel/ScheduledMatch';
import { Team } from '../DataModel/Team';
import Tournament from '../DataModel/Tournament';

export interface IStructuralEditCheck {
  ok: boolean;
  reason?: string;
}

export interface IScheduledStructureAnchor {
  scheduled: import('../DataModel/ScheduledMatch').ScheduledMatch;
  phase: import('../DataModel/Phase').Phase;
  roundIndex: number;
}

/** A team's name as it stood before a structural edit, held against the team object itself. */
export interface ITeamNameAnchor {
  team: Team;
  name: string;
}

/**
 * An official `Match`'s computed id as it stood before a structural edit.
 *
 * `Match.id` is `Match_<number>~<left abbreviation><right abbreviation>`, so it moves when a team
 * on either side is renamed. The number alone is stable, but it is not what anything stores: a
 * `ScheduledMatch` persists the whole computed id in `resultMatchId`. Holding the old id against
 * the `Match` object is what makes an exact old→new mapping possible, with no guessing from rounds
 * or team names.
 */
export interface IOfficialResultAnchor {
  match: Match;
  matchId: string;
}

const activeStatuses = new Set([ScheduledMatchStatus.Playing, ScheduledMatchStatus.Submitted]);

function allOfficialMatches(tournament: Tournament): Match[] {
  return tournament.phases.flatMap((phase) => phase.getAllMatches());
}

/** Structural edits that would invalidate a live or submitted room game are refused before commit. */
export function canRenameTeam(tournament: Tournament, oldName: string, newName: string): IStructuralEditCheck {
  if (oldName === newName) return { ok: true };
  const active = tournament.scheduledMatches.find(
    (match) => activeStatuses.has(match.status) && match.involvesTeam(oldName),
  );
  if (active) {
    return {
      ok: false,
      reason: `${active.describe()} is ${
        active.status
      } in room scoring. Finish or reject that game before renaming the team.`,
    };
  }
  if (tournament.findTeamByName(newName) && tournament.findTeamByName(newName)?.name !== oldName) {
    return { ok: false, reason: `A different team is already named ${newName}.` };
  }
  return { ok: true };
}

/** Capture every team's name before an edit, so the exact set of renames can be read back after it. */
export function captureTeamNames(tournament: Tournament): ITeamNameAnchor[] {
  return tournament.getListOfAllTeams().map((team) => ({ team, name: team.name }));
}

/** Restore captured team names, to undo the identity half of an edit that could not be completed. */
export function restoreTeamNames(anchors: ITeamNameAnchor[]): void {
  for (const anchor of anchors) anchor.team.name = anchor.name;
}

/**
 * Every rename the edit actually performed, read from object identity rather than inferred.
 *
 * Editing one team can rename more than one: the team form edits the organization name, and
 * committing it recompiles the name of every team on that registration. Reading the renames back
 * off the team objects catches all of them without the caller having to predict which.
 */
function renamesFromAnchors(anchors: ITeamNameAnchor[]): Map<string, string> {
  const renames = new Map<string, string>();
  for (const anchor of anchors) {
    if (anchor.team.name !== anchor.name) renames.set(anchor.name, anchor.team.name);
  }
  return renames;
}

/**
 * Apply a validated rename to every durable scheduled reference in one commit.
 *
 * `anchors`, when supplied, extend the reconciliation to every other team the same edit renamed —
 * the sibling teams of a registration whose organization name changed. The explicit old/new pair
 * remains the primary rename and is always applied.
 */
export function reconcileTeamRename(
  tournament: Tournament,
  oldName: string,
  newName: string,
  anchors: ITeamNameAnchor[] = [],
): IStructuralEditCheck {
  const renames = renamesFromAnchors(anchors);
  if (oldName !== newName) renames.set(oldName, newName);
  if (renames.size === 0) return { ok: true };

  for (const renamedFrom of renames.keys()) {
    const active = tournament.scheduledMatches.find(
      (match) => activeStatuses.has(match.status) && match.involvesTeam(renamedFrom),
    );
    if (active) {
      return {
        ok: false,
        reason: `${active.describe()} is active, so its team reference cannot be renamed yet.`,
      };
    }
  }
  // The manager validates before saving the Team, so after the Team copy is committed the old
  // name is absent and the new name is present. Rechecking by name here would mistake that
  // intended state for a duplicate and leave the durable schedule half-reconciled.
  const stillOld = tournament.findTeamByName(oldName);
  const newTeams = tournament.getListOfAllTeams().filter((team) => team.name === newName);
  if (oldName !== newName && stillOld && newTeams.length > 0) {
    return { ok: false, reason: `A different team is already named ${newName}.` };
  }
  for (const match of tournament.scheduledMatches) {
    const nextLeft = renames.get(match.leftTeamName);
    const nextRight = renames.get(match.rightTeamName);
    if (nextLeft !== undefined) match.leftTeamName = nextLeft;
    if (nextRight !== undefined) match.rightTeamName = nextRight;
  }
  return { ok: true };
}

/**
 * Capture the computed identity of every official `Match` before a structural edit.
 *
 * Cheap enough to do unconditionally: it is one string per game played so far.
 */
export function captureOfficialResultIdentities(tournament: Tournament): IOfficialResultAnchor[] {
  return allOfficialMatches(tournament).map((match) => ({ match, matchId: match.id }));
}

/**
 * Can an edit that moves official `Match` ids be reconciled at all?
 *
 * Asked before anything is mutated, so the answer is a refusal rather than a half-applied edit.
 * The only way the remap can be ambiguous is if the official Match ids are not already unique, in
 * which case an old id does not name one game and there is nothing safe to rewrite it to.
 */
export function canReconcileOfficialResultIdentities(tournament: Tournament): IStructuralEditCheck {
  const seen = new Set<string>();
  for (const match of allOfficialMatches(tournament)) {
    if (seen.has(match.id)) {
      return {
        ok: false,
        reason: `Two official games share the id ${match.id}, so accepted results cannot be relinked safely. Resolve that before renaming.`,
      };
    }
    seen.add(match.id);
  }
  return { ok: true };
}

/**
 * Point every durable YellowFruit reference at the id its `Match` has now.
 *
 * Only YellowFruit's own operational references are rewritten. The `Match` objects themselves are
 * untouched, so nothing about the statistical meaning of a past game changes; QBJ ids are recomputed
 * from the current model at export time and were never stale to begin with.
 *
 * Either the whole remap applies or none of it does: the mapping is built and checked in full before
 * a single `resultMatchId` is written.
 */
export function reconcileOfficialResultIdentities(
  tournament: Tournament,
  anchors: IOfficialResultAnchor[],
): IStructuralEditCheck {
  const moved = new Map<string, string>();
  for (const anchor of anchors) {
    const currentId = anchor.match.id;
    if (currentId === anchor.matchId) continue;
    const alreadyMapped = moved.get(anchor.matchId);
    if (alreadyMapped !== undefined && alreadyMapped !== currentId) {
      return {
        ok: false,
        reason: `The official game id ${anchor.matchId} identified more than one game, so its accepted result cannot be relinked.`,
      };
    }
    moved.set(anchor.matchId, currentId);
  }
  if (moved.size === 0) return { ok: true };

  const idCounts = new Map<string, number>();
  for (const match of allOfficialMatches(tournament)) {
    idCounts.set(match.id, (idCounts.get(match.id) ?? 0) + 1);
  }
  for (const newId of moved.values()) {
    if (idCounts.get(newId) !== 1) {
      return { ok: false, reason: `The renamed game id ${newId} does not identify exactly one official game.` };
    }
  }

  for (const scheduled of tournament.scheduledMatches) {
    if (!scheduled.resultMatchId) continue;
    const nextId = moved.get(scheduled.resultMatchId);
    if (nextId !== undefined) scheduled.resultMatchId = nextId;
  }
  return { ok: true };
}

/**
 * The commit-time assertion that an accepted result is still one whole record.
 *
 * `OperationalIntegrity` remains the durable validator: it is what a file is read through, and it
 * quarantines what it cannot repair. That is the wrong shape for a structural edit, which needs a
 * yes or no *before* committing rather than a tournament that has been quietly marked for review.
 * This checks the same property — one accepted `ScheduledMatch`, one `Match`, agreeing on round and
 * teams — and answers with a refusal.
 */
export function validateAcceptedResultLinks(tournament: Tournament): IStructuralEditCheck {
  const matches = allOfficialMatches(tournament);
  for (const scheduled of tournament.scheduledMatches) {
    if (!scheduled.isAccepted() || !scheduled.resultMatchId) continue;
    const linked = matches.filter((match) => match.id === scheduled.resultMatchId);
    if (linked.length !== 1) {
      return {
        ok: false,
        reason: `${scheduled.describe()} is an accepted result, but its official game could not be identified afterwards.`,
      };
    }
    const round = tournament.getRoundOfMatch(linked[0]);
    const teams = [linked[0].leftTeam.team?.name, linked[0].rightTeam.team?.name];
    if (
      !round ||
      round.number !== scheduled.roundNumber ||
      teams[0] === undefined ||
      teams[1] === undefined ||
      !scheduled.matchesTeams(teams[0], teams[1])
    ) {
      return {
        ok: false,
        reason: `${scheduled.describe()} is an accepted result, but its official game no longer agrees with its round or teams.`,
      };
    }
  }
  return { ok: true };
}

/** Update pool-name references as one structural edit; Pool validation handles duplicate names. */
export function reconcilePoolRename(
  tournament: Tournament,
  phaseCode: string,
  oldName: string,
  newName: string,
): IStructuralEditCheck {
  if (oldName === newName) return { ok: true };
  for (const scheduled of tournament.scheduledMatches) {
    if (scheduled.phaseCode === phaseCode && scheduled.poolName === oldName) scheduled.poolName = newName;
  }
  return { ok: true };
}

/** Team deletion is only safe when no durable schedule or official history mentions the team. */
export function canDeleteTeam(tournament: Tournament, teamName: string): IStructuralEditCheck {
  const scheduled = tournament.scheduledMatches.find((match) => match.involvesTeam(teamName));
  if (scheduled) {
    return {
      ok: false,
      reason: `${scheduled.describe()} is part of the Match Plan. Cancel or resolve the scheduled game before deleting the team.`,
    };
  }
  const played = tournament.phases
    .flatMap((phase) => phase.getAllMatches())
    .find((match) => match.leftTeam.team?.name === teamName || match.rightTeam.team?.name === teamName);
  if (played) return { ok: false, reason: `${teamName} has official game history and cannot be deleted.` };
  return { ok: true };
}

/** Recompute schedule phase references after a phase/round structure edit. */
export function reconcileScheduledStructure(tournament: Tournament): IStructuralEditCheck {
  return reconcileScheduledStructureFromAnchors(tournament);
}

/** Capture object identity and round position before a phase operation renumbers rounds. */
export function captureScheduledStructure(tournament: Tournament): IScheduledStructureAnchor[] {
  return tournament.scheduledMatches.flatMap((scheduled) => {
    const phase = tournament.whichPhaseIsRoundNumberIn(scheduled.roundNumber);
    const roundIndex = phase?.rounds.findIndex((round) => round.number === scheduled.roundNumber) ?? -1;
    return phase && roundIndex >= 0 ? [{ scheduled, phase, roundIndex }] : [];
  });
}

/** Reconcile by phase/round identity first, so renumbering cannot attach a game to the wrong phase. */
export function reconcileScheduledStructureFromAnchors(
  tournament: Tournament,
  anchors: IScheduledStructureAnchor[] = [],
): IStructuralEditCheck {
  const anchored = new Set(anchors.map((anchor) => anchor.scheduled));
  for (const anchor of anchors) {
    if (!tournament.scheduledMatches.includes(anchor.scheduled)) continue;
    const round = anchor.phase.rounds[anchor.roundIndex];
    if (!round) {
      if (activeStatuses.has(anchor.scheduled.status)) {
        return { ok: false, reason: `${anchor.scheduled.describe()} is active but its round no longer exists.` };
      }
      continue;
    }
    anchor.scheduled.roundNumber = round.number;
    anchor.scheduled.phaseCode = anchor.phase.code;
    if (anchor.scheduled.poolName && !anchor.phase.pools.some((pool) => pool.name === anchor.scheduled.poolName)) {
      anchor.scheduled.poolName = undefined;
    }
  }

  for (const scheduled of tournament.scheduledMatches) {
    if (anchored.has(scheduled)) continue;
    const phase = tournament.whichPhaseIsRoundNumberIn(scheduled.roundNumber);
    if (!phase) {
      if (activeStatuses.has(scheduled.status)) {
        return { ok: false, reason: `${scheduled.describe()} is active but its round no longer exists.` };
      }
      continue;
    }
    scheduled.phaseCode = phase.code;
    if (scheduled.poolName && !phase.pools.some((pool) => pool.name === scheduled.poolName)) {
      scheduled.poolName = undefined;
    }
  }
  return { ok: true };
}
