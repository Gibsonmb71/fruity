import { CommonRuleSets } from '../DataModel/ScoringRules';
import { ScheduledMatchStatus } from '../DataModel/ScheduledMatch';
import Tournament from '../DataModel/Tournament';
import { ReadinessStatus } from './ReadinessSemantics';

export type VerificationStatus = ReadinessStatus;

export interface IVerificationCheck {
  id: string;
  status: VerificationStatus;
  text: string;
}

export interface IPublicationReadiness {
  checks: IVerificationCheck[];
  status: VerificationStatus;
  applicableNaqt: boolean;
}

function statusForProblem(problem: boolean, unknown: boolean): VerificationStatus {
  if (problem) return 'problem';
  return unknown ? 'unknown' : 'verified';
}

function pluralizeGameCount(count: number, suffix: string): string {
  return `${count} game${count === 1 ? '' : 's'}${suffix}`;
}

/**
 * Resolve only facts that can be established from the tournament model. Manual entry has no
 * external expected-game list, so its completeness check is deliberately unknown.
 */
export function resolvePublicationReadiness(
  tournament: Tournament,
  browserRoomScoringEnabled = tournament.roomScoringMode === 'browser',
): IPublicationReadiness {
  const matches = tournament.phases.flatMap((phase) => phase.rounds.flatMap((round) => round.matches));
  const invalidMatches = matches.filter((match) => match.getErrorMessages().length > 0);
  const missingTossups = matches.filter((match) => !match.isForfeit() && match.tossupsRead === undefined);
  const applicableNaqt =
    tournament.standardRuleSet === CommonRuleSets.NaqtTimed ||
    tournament.standardRuleSet === CommonRuleSets.NaqtUntimed;
  const scheduled = tournament.scheduledMatches.filter((match) => match.status !== ScheduledMatchStatus.Cancelled);
  const acceptedScheduled = scheduled.filter((match) => match.status === ScheduledMatchStatus.Accepted);

  const checks: IVerificationCheck[] = [
    {
      id: 'game-data',
      status: statusForProblem(invalidMatches.length > 0, matches.length === 0),
      text: invalidMatches.length > 0 ? pluralizeGameCount(invalidMatches.length, ' invalid') : 'Game data valid',
    },
    {
      id: 'statistics',
      status: statusForProblem(false, tournament.stats.length === 0 || matches.length === 0),
      text: tournament.stats.length > 0 ? 'Statistics compiled' : 'Statistics not compiled yet',
    },
  ];

  if (applicableNaqt) {
    checks.push({
      id: 'tossups-heard',
      status: statusForProblem(missingTossups.length > 0, matches.length === 0),
      text:
        missingTossups.length > 0
          ? pluralizeGameCount(missingTossups.length, ' lack tossups heard')
          : 'Tossups heard recorded',
    });
  }

  const completenessUnknown = !browserRoomScoringEnabled || scheduled.length === 0;
  const completenessProblem =
    browserRoomScoringEnabled && scheduled.length > 0 && acceptedScheduled.length !== scheduled.length;
  let completenessText = 'Game completeness cannot be verified automatically for manual entry';
  if (browserRoomScoringEnabled) {
    if (scheduled.length === 0) completenessText = 'Game completeness cannot be verified without a Match Plan';
    else if (completenessProblem) {
      completenessText = pluralizeGameCount(scheduled.length - acceptedScheduled.length, ' not accepted');
    } else completenessText = 'All scheduled games are accepted';
  }
  checks.push({
    id: 'completeness',
    status: statusForProblem(completenessProblem, completenessUnknown),
    text: completenessText,
  });

  checks.push({
    id: 'forfeits',
    status: statusForProblem(
      matches.some((match) => match.isForfeit() && !match.leftTeam.forfeitLoss && !match.rightTeam.forfeitLoss),
      matches.length === 0,
    ),
    text: 'Forfeits are represented in the game data',
  });

  let status: VerificationStatus = 'verified';
  if (checks.some((check) => check.status === 'problem')) status = 'problem';
  else if (checks.some((check) => check.status === 'unknown')) status = 'unknown';
  return { checks, status, applicableNaqt };
}
