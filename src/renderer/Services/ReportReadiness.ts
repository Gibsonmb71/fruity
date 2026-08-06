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
      text:
        invalidMatches.length > 0
          ? `${invalidMatches.length} invalid game${invalidMatches.length === 1 ? '' : 's'}`
          : 'Game data valid',
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
          ? `${missingTossups.length} game${missingTossups.length === 1 ? '' : 's'} lack tossups heard`
          : 'Tossups heard recorded',
    });
  }

  const completenessUnknown = !browserRoomScoringEnabled || scheduled.length === 0;
  const completenessProblem =
    browserRoomScoringEnabled && scheduled.length > 0 && acceptedScheduled.length !== scheduled.length;
  checks.push({
    id: 'completeness',
    status: statusForProblem(completenessProblem, completenessUnknown),
    text: browserRoomScoringEnabled
      ? scheduled.length === 0
        ? 'Game completeness cannot be verified without a Match Plan'
        : completenessProblem
        ? `${scheduled.length - acceptedScheduled.length} scheduled game${
            scheduled.length - acceptedScheduled.length === 1 ? '' : 's'
          } not accepted`
        : 'All scheduled games are accepted'
      : 'Game completeness cannot be verified automatically for manual entry',
  });

  checks.push({
    id: 'forfeits',
    status: statusForProblem(
      matches.some((match) => match.isForfeit() && !match.leftTeam.forfeitLoss && !match.rightTeam.forfeitLoss),
      matches.length === 0,
    ),
    text: 'Forfeits are represented in the game data',
  });

  const status = checks.some((check) => check.status === 'problem')
    ? 'problem'
    : checks.some((check) => check.status === 'unknown')
    ? 'unknown'
    : 'verified';
  return { checks, status, applicableNaqt };
}
