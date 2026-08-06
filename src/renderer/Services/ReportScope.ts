import HtmlReportGenerator from '../DataModel/HTMLReports';
import { Match } from '../DataModel/Match';
import { Phase, PhaseTypes } from '../DataModel/Phase';
import { Round } from '../DataModel/Round';
import { AggregateStandings, PhaseStandings } from '../DataModel/StatSummaries';
import Tournament from '../DataModel/Tournament';

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

function cloneRound(round: Round): Round {
  const copy = Object.create(Object.getPrototypeOf(round)) as Round;
  Object.assign(copy, round);
  copy.matches = round.matches.slice();
  return copy;
}

function clonePhase(phase: Phase): Phase {
  const copy = Object.create(Object.getPrototypeOf(phase)) as Phase;
  Object.assign(copy, phase);
  copy.rounds = phase.rounds.map((round) => cloneRound(round));
  copy.pools = phase.pools.slice();
  return copy;
}

/**
 * Make a report-only Tournament projection. The original tournament and its phases are never
 * modified; the existing HTML generator continues to own the output format and links.
 */
export function projectTournamentForReport(tournament: Tournament, scope: IReportScope): Tournament {
  const selectedCodes =
    scope.phaseCodes.length > 0 ? new Set(scope.phaseCodes) : new Set(tournament.phases.map((p) => p.code));
  const selected = tournament.phases.filter((phase) => selectedCodes.has(phase.code));
  const phases = selected.map((phase) => clonePhase(phase));
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
  phasePairs.forEach(({ original, projected }) => {
    const carryoverMatches =
      scope.includeCarryover && original.phaseType === PhaseTypes.Playoff
        ? tournament.getCarryoverMatches(original)
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
        const sourcePhase = tournament.findPhaseByRound(tournament.getRoundOfMatch(match)!);
        if (sourcePhase && !selectedCodes.has(sourcePhase.code)) {
          const round = tournament.getRoundOfMatch(match);
          if (round) {
            additionalCarryoverMatches.push({ match, round, phase: sourcePhase });
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
  return projection;
}
