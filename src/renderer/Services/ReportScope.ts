import HtmlReportGenerator from '../DataModel/HTMLReports';
import { Match } from '../DataModel/Match';
import { Phase, PhaseTypes } from '../DataModel/Phase';
import { Round } from '../DataModel/Round';
import { AggregateStandings, PhaseStandings } from '../DataModel/StatSummaries';
import Tournament from '../DataModel/Tournament';

const reportDiagnostics = new WeakMap<Tournament, string[]>();

export function getReportDiagnostics(tournament: Tournament): string[] {
  return reportDiagnostics.get(tournament) ?? [];
}

/** Ephemeral report selection; never serialized into .yft, QBJ, or SQBS. */
export interface IReportScope {
  phaseCodes: string[];
  includeCarryover: boolean;
}

export function isEntireReportScope(tournament: Tournament, scope: IReportScope | null | undefined): boolean {
  if (!scope || !scope.includeCarryover) return false;
  if (scope.phaseCodes.length === 0) return true;
  const selected = new Set(scope.phaseCodes);
  return selected.size === tournament.phases.length && tournament.phases.every((phase) => selected.has(phase.code));
}

function cloneMatch(match: Match, tournament: Tournament): Match {
  const copy = match.makeCopy();
  const leftTeamName = match.leftTeam.team?.name;
  const rightTeamName = match.rightTeam.team?.name;
  if (leftTeamName) copy.leftTeam.team = tournament.findTeamByName(leftTeamName);
  if (rightTeamName) copy.rightTeam.team = tournament.findTeamByName(rightTeamName);
  return copy;
}

function carryoverMatchesForReport(tournament: Tournament, phase: Phase, diagnostics: string[]): Match[] {
  const malformedMatches = tournament.phases
    .flatMap((candidate) => candidate.getAllMatches())
    .filter((match) => !Array.isArray(match.carryoverPhases));
  malformedMatches.forEach((match) => {
    diagnostics.push(`Skipped carryover metadata for ${match.id}: the carryover list was malformed.`);
  });

  let matches: Match[];
  try {
    matches = tournament.getCarryoverMatches(phase);
  } catch {
    diagnostics.push(`Skipped carryover games for ${phase.name}: carryover metadata was malformed.`);
    return [];
  }

  return matches.filter((match) => {
    if (tournament.getRoundOfMatch(match)) return true;
    diagnostics.push(`Skipped carryover game ${match.id}: it could not be resolved to a source round.`);
    return false;
  });
}

function cloneRound(round: Round, tournament: Tournament): Round {
  const copy = Object.create(Object.getPrototypeOf(round)) as Round;
  Object.assign(copy, round);
  // Report generation is allowed to compile/rank its projection. Match copies keep validation and
  // score calculations from ever writing into the authoritative Match objects.
  copy.matches = round.matches.map((match) => cloneMatch(match, tournament));
  copy.roomIds = round.roomIds?.slice();
  return copy;
}

function clonePhase(phase: Phase, tournament: Tournament): Phase {
  const copy = Object.create(Object.getPrototypeOf(phase)) as Phase;
  Object.assign(copy, phase);
  copy.rounds = phase.rounds.map((round) => cloneRound(round, tournament));
  copy.pools = phase.pools.map((pool) => {
    const poolCopy = Object.create(Object.getPrototypeOf(pool));
    Object.assign(poolCopy, pool);
    poolCopy.seeds = pool.seeds.slice();
    poolCopy.preferredRoomIds = pool.preferredRoomIds?.slice();
    poolCopy.autoAdvanceRules = pool.autoAdvanceRules.map((rule) => ({
      ...rule,
      ranksThatAdvance: rule.ranksThatAdvance.slice(),
    }));
    poolCopy.poolTeams = pool.poolTeams.map((poolTeam) => {
      const poolTeamCopy = Object.create(Object.getPrototypeOf(poolTeam));
      Object.assign(poolTeamCopy, poolTeam);
      return poolTeamCopy;
    });
    return poolCopy;
  });
  return copy;
}

/**
 * Make a report-only Tournament projection. The original tournament and its phases are never
 * modified; the existing HTML generator continues to own the output format and links.
 */
export function projectTournamentForReport(tournament: Tournament, scope: IReportScope): Tournament {
  const diagnostics: string[] = [];
  const selectedCodes =
    scope.phaseCodes.length > 0 ? new Set(scope.phaseCodes) : new Set(tournament.phases.map((p) => p.code));
  const selected = tournament.phases.filter((phase) => selectedCodes.has(phase.code));
  const phases = selected.map((phase) => clonePhase(phase, tournament));
  const phasePairs = selected.map((phase, index) => ({ original: phase, projected: phases[index] }));
  const projection = Object.create(Object.getPrototypeOf(tournament)) as Tournament;
  Object.assign(projection, tournament);
  projection.phases = phases;
  projection.stats = [];
  delete projection.prelimsPlusPlayoffStats;

  const additionalCarryoverMatches: Array<{ match: Match; round: Round; phase: Phase }> = [];
  const selectedFullPhases = selected.filter((phase) => phase.isFullPhase());
  const selectedLastFullPhase = selectedFullPhases[selectedFullPhases.length - 1];
  projection.finalRankingsReady =
    tournament.finalRankingsReady && selectedLastFullPhase === tournament.getLastFullPhase();
  const phaseStats: PhaseStandings[] = [];
  const sourcePhaseCopies = new Map<Phase, Phase>();
  phasePairs.forEach(({ original, projected }) => {
    const carryoverMatches =
      scope.includeCarryover && original.phaseType === PhaseTypes.Playoff
        ? carryoverMatchesForReport(tournament, original, diagnostics).map((match) => cloneMatch(match, tournament))
        : [];
    if (projected.isFullPhase()) {
      const stats = new PhaseStandings(projected, carryoverMatches, tournament.scoringRules);
      stats.compileStats(projection.finalRankingsReady && projected === selectedLastFullPhase);
      stats.compileIndividualStats();
      phaseStats.push(stats);
    }

    // A carryover game already appears in the selected source phase's rounds. Only add it to the
    // cumulative projection when that source phase is outside the selected report scope.
    if (scope.includeCarryover && original.phaseType === PhaseTypes.Playoff) {
      carryoverMatches.forEach((match) => {
        const originalMatch = carryoverMatchesForReport(tournament, original, diagnostics).find(
          (candidate) => candidate.id === match.id,
        );
        const sourceRound = originalMatch ? tournament.getRoundOfMatch(originalMatch) : undefined;
        const sourcePhase = sourceRound ? tournament.findPhaseByRound(sourceRound) : undefined;
        if (sourcePhase && !selectedCodes.has(sourcePhase.code)) {
          const projectedSourcePhase =
            sourcePhaseCopies.get(sourcePhase) ??
            (() => {
              const copy = clonePhase(sourcePhase, tournament);
              sourcePhaseCopies.set(sourcePhase, copy);
              return copy;
            })();
          const round = projectedSourcePhase.rounds.find((candidate) => candidate.number === sourceRound?.number);
          const projectedMatch = round?.matches.find((candidate) => candidate.id === match.id);
          if (round && projectedMatch) {
            additionalCarryoverMatches.push({ match: projectedMatch, round, phase: projectedSourcePhase });
          }
        }
      });
    }
  });
  projection.stats = phaseStats;
  projection.cumulativeStats = new AggregateStandings(
    projection.getListOfAllTeams(),
    phases,
    projection.scoringRules,
    additionalCarryoverMatches,
  );
  if (projection.finalRankingsReady) projection.cumulativeStats.arrangeTeamsForFinalRanking();
  else if (projection.scoringRules.useBonuses) projection.cumulativeStats.sortTeamsByPPB();
  else projection.cumulativeStats.sortTeamsByPptuh();
  projection.htmlGenerator = new HtmlReportGenerator(projection);
  reportDiagnostics.set(projection, diagnostics);
  return projection;
}
