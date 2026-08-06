import { Match } from '../DataModel/Match';
import { Phase, PhaseTypes } from '../DataModel/Phase';
import { PlayerStats, PoolTeamStats, PhaseStandings } from '../DataModel/StatSummaries';
import { ScheduledMatchStatus } from '../DataModel/ScheduledMatch';
import Tournament from '../DataModel/Tournament';
import { ScoringRules } from '../DataModel/ScoringRules';
import {
  IPublicAnswerCount,
  IPublicIndividualStanding,
  IPublicLiveSnapshot,
  IPublicLiveSettings,
  IPublicNextRound,
  IPublicPhaseStanding,
  IPublicRecentResult,
  IPublicRoundSummary,
  IPublicTeamStanding,
} from '../../shared/LiveTypes';

const maxRecentResults = 24;

interface IAcceptedMatchLocation {
  match: Match;
  phase: Phase;
  roundNumber: number;
  roundName: string;
}

/**
 * Make the intentionally small public live view from YellowFruit's already-compiled statistics.
 * This is the only place where internal standings objects become public DTOs; the browser never
 * receives enough data to reimplement ranking or tiebreak rules.
 */
export default function buildPublicLiveSnapshot(tournament: Tournament, now = new Date()): IPublicLiveSnapshot | null {
  if (!tournament.liveDisplaySettings.enabled) return null;

  // The existing compiler is the source of truth. Full-report compilation is needed for cumulative
  // team stats and individual stats, while the second argument gives phase standings their normal
  // rank/tie display strings.
  tournament.compileStats(true, true);

  const rules = tournament.scoringRules;
  const settings: IPublicLiveSettings = {
    slides: { ...tournament.liveDisplaySettings.slides },
    slideDurationSeconds: tournament.liveDisplaySettings.slideDurationSeconds,
    rowsPerSlide: tournament.liveDisplaySettings.rowsPerSlide,
    theme: tournament.liveDisplaySettings.theme,
    showLastUpdated: tournament.liveDisplaySettings.showLastUpdated,
  };

  const allMatches = listMatches(tournament);
  const phaseRankByTeam = makeCurrentPhaseRankMap(tournament.stats);
  const teamStandings = tournament.cumulativeStats
    ? tournament.cumulativeStats.teamStats.map((stats) =>
        toTeamStanding(stats, stats.rank || phaseRankByTeam.get(stats.team.name) || ''),
      )
    : tournament.getListOfAllTeams().map((team) => emptyTeamStanding(team.name));

  const individualSource = findIndividualSource(tournament.stats);
  const individualStandings = individualSource
    ? individualSource.players
        .filter((stats) => stats.tossupsHeard > 0)
        .map((stats) => toIndividualStanding(stats, rules))
    : [];

  const phaseStandings = tournament.stats.map(toPhaseStanding);
  const recentResults = allMatches
    .slice()
    .reverse()
    .map((entry) => toRecentResult(entry))
    .slice(0, maxRecentResults);

  return {
    version: 1,
    tournamentName: tournament.name || 'Untitled tournament',
    lastUpdatedAt: now.toISOString(),
    latestCompletedRound: latestRound(allMatches),
    teamStandings,
    individualStandings,
    phaseStandings,
    recentResults,
    nextRound: releasedNextRound(tournament),
    settings,
    metricLabels: {
      teamPpg: `PP${rules.regulationTossupCount}TUH`,
      individualPptuh: `PP${rules.regulationTossupCount}TUH`,
      teamPpb: rules.useBonuses ? 'PPB' : null,
    },
  };
}

function listMatches(tournament: Tournament): IAcceptedMatchLocation[] {
  const entries: IAcceptedMatchLocation[] = [];
  for (const phase of tournament.phases) {
    for (const round of phase.rounds) {
      for (const match of round.matches) {
        // A Match is only present after manual import or explicit Inbox acceptance. Live snapshots
        // and finals awaiting review live in SessionStore and never reach this list.
        if (!match.leftTeam.team || !match.rightTeam.team) continue;
        entries.push({ match, phase, roundNumber: round.number, roundName: round.displayName() });
      }
    }
  }
  return entries;
}

function makeCurrentPhaseRankMap(phases: PhaseStandings[]): Map<string, string> {
  const result = new Map<string, string>();
  const latest = phases[phases.length - 1];
  if (!latest) return result;
  for (const pool of latest.pools) {
    for (const team of pool.poolTeams) {
      if (team.team.name) result.set(team.team.name, team.rank);
    }
  }
  return result;
}

function findIndividualSource(phases: PhaseStandings[]): PhaseStandings | undefined {
  return (
    phases.find((phase) => phase.phase.phaseType === PhaseTypes.Prelim) ??
    phases.find((phase) => phase.players.length > 0)
  );
}

function toPhaseStanding(phaseStats: PhaseStandings): IPublicPhaseStanding {
  return {
    phaseName: phaseStats.phase.name,
    phaseCode: phaseStats.phase.code,
    pools: phaseStats.pools.map((poolStats) => ({
      poolName: poolStats.pool.name,
      teams: poolStats.poolTeams.map((stats) => toTeamStanding(stats, stats.rank)),
    })),
  };
}

function toTeamStanding(stats: PoolTeamStats, rank: string): IPublicTeamStanding {
  const rules = stats.scoringRules;
  return {
    rank,
    teamName: stats.team.name,
    record: stats.getRecord(),
    wins: stats.wins,
    losses: stats.losses,
    ties: stats.ties,
    winPct: finiteOrNull(stats.getWinPct()),
    ppg: stats.getCorrectTuh() === 0 ? null : finiteOrNull(stats.getPtsPerRegTuh() * rules.regulationTossupCount),
    ppb: rules.useBonuses ? finiteOrNull(stats.getPtsPerBonus()) : null,
    tossupsHeard: stats.getCorrectTuh(),
    totalPoints: stats.totalPoints,
    lightningPerGame: rules.useLightningRounds() ? finiteOrNull(stats.getLightningPtsPerMatch()) : null,
  };
}

function emptyTeamStanding(teamName: string): IPublicTeamStanding {
  return {
    rank: '',
    teamName,
    record: '0-0',
    wins: 0,
    losses: 0,
    ties: 0,
    winPct: null,
    ppg: null,
    ppb: null,
    tossupsHeard: 0,
    totalPoints: 0,
    lightningPerGame: null,
  };
}

function toIndividualStanding(stats: PlayerStats, rules: ScoringRules): IPublicIndividualStanding {
  const pptuh = stats.getPptuh();
  return {
    rank: stats.rank + (stats.rankTie ? '=' : ''),
    playerName: stats.player.name,
    teamName: stats.team.name,
    gamesPlayed: stats.gamesPlayed,
    tossupsHeard: stats.tossupsHeard,
    pptuh: pptuh === undefined ? null : pptuh * rules.regulationTossupCount,
    totalPoints: stats.getTotalPoints(),
    answerCounts: stats.tossupCounts.map((count) =>
      toAnswerCount(count.answerType.value, count.answerType.label, count.answerType.shortLabel, count.number ?? 0),
    ),
  };
}

function toAnswerCount(value: number, label: string, shortLabel: string, count: number): IPublicAnswerCount {
  return { value, label, shortLabel, count };
}

function toRecentResult(entry: IAcceptedMatchLocation): IPublicRecentResult {
  const { match } = entry;
  const leftScore = finiteOrNull(match.leftTeam.points);
  const rightScore = finiteOrNull(match.rightTeam.points);
  let result: IPublicRecentResult['result'] = 'not-played';
  if (match.leftTeam.forfeitLoss && match.rightTeam.forfeitLoss) result = 'not-played';
  else if (match.leftTeam.forfeitLoss || match.rightTeam.forfeitLoss) result = 'forfeit';
  else if (leftScore !== null && rightScore !== null) {
    if (leftScore === rightScore) result = 'tie';
    else if (leftScore > rightScore) result = 'left';
    else result = 'right';
  }

  return {
    roundNumber: entry.roundNumber,
    roundName: entry.roundName,
    phaseName: entry.phase.name,
    leftTeam: match.leftTeam.team?.name ?? 'Unknown team',
    rightTeam: match.rightTeam.team?.name ?? 'Unknown team',
    leftScore,
    rightScore,
    result,
    overtime: (match.overtimeTossupsRead ?? 0) > 0,
  };
}

function latestRound(matches: IAcceptedMatchLocation[]): IPublicRoundSummary | null {
  const latest = matches.reduce<IAcceptedMatchLocation | null>(
    (current, entry) => (current === null || entry.roundNumber > current.roundNumber ? entry : current),
    null,
  );
  if (!latest) return null;
  return { number: latest.roundNumber, name: latest.roundName };
}

function releasedNextRound(tournament: Tournament): IPublicNextRound | null {
  const released = tournament.releasedRoundNumber;
  if (released === null) return null;

  const round = tournament.getRoundObjByNumber(released);
  const roundSummary: IPublicRoundSummary = {
    number: released,
    name: round?.displayName() ?? `Round ${released}`,
  };
  const roomNames = new Map(tournament.rooms.map((room) => [room.id, room.name]));
  const assignments = tournament.scheduledMatches
    .filter(
      (match) => match.roundNumber === released && match.roomId && match.status !== ScheduledMatchStatus.Cancelled,
    )
    .map((match) => ({
      leftTeam: match.leftTeamName,
      rightTeam: match.rightTeamName,
      roomName: roomNames.get(match.roomId as string) ?? '',
    }))
    .filter((assignment) => assignment.roomName !== '');

  if (assignments.length === 0) return null;
  return { round: roundSummary, assignments };
}

function finiteOrNull(value: number | undefined): number | null {
  return value !== undefined && Number.isFinite(value) ? value : null;
}
