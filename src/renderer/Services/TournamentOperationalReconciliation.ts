import { ScheduledMatchStatus } from '../DataModel/ScheduledMatch';
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

const activeStatuses = new Set([ScheduledMatchStatus.Playing, ScheduledMatchStatus.Submitted]);

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

/** Apply a validated rename to every durable scheduled reference in one commit. */
export function reconcileTeamRename(tournament: Tournament, oldName: string, newName: string): IStructuralEditCheck {
  if (oldName === newName) return { ok: true };
  const active = tournament.scheduledMatches.find(
    (match) => activeStatuses.has(match.status) && match.involvesTeam(oldName),
  );
  if (active) {
    return {
      ok: false,
      reason: `${active.describe()} is active, so its team reference cannot be renamed yet.`,
    };
  }
  // The manager validates before saving the Team, so after the Team copy is committed the old
  // name is absent and the new name is present. Rechecking by name here would mistake that
  // intended state for a duplicate and leave the durable schedule half-reconciled.
  const stillOld = tournament.findTeamByName(oldName);
  const newTeams = tournament.getListOfAllTeams().filter((team) => team.name === newName);
  if (stillOld && newTeams.length > 0) return { ok: false, reason: `A different team is already named ${newName}.` };
  for (const match of tournament.scheduledMatches) {
    if (match.leftTeamName === oldName) match.leftTeamName = newName;
    if (match.rightTeamName === oldName) match.rightTeamName = newName;
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
