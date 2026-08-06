import { Phase } from '../DataModel/Phase';
import { Match } from '../DataModel/Match';
import { ScheduledMatch } from '../DataModel/ScheduledMatch';
import Tournament from '../DataModel/Tournament';
import { TournamentRoom } from '../DataModel/TournamentRoom';
import {
  ScheduleIssueSeverity,
  IScheduleIssue,
  roundsWithGames,
  summarizeRound,
  validatePhaseScheduleCompleteness,
  validateSchedule,
} from './ScheduleService';

/** Stable destinations used by issue actions and the compact header indicator. */
export type ReadinessTarget =
  | 'setup:tournament'
  | 'setup:rules'
  | 'setup:teams'
  | 'setup:format'
  | 'games'
  | 'control:live'
  | 'control:match-plan'
  | 'control:rooms'
  | 'control:display'
  | 'reports';

export type TournamentOperationState =
  | 'setup'
  | 'traditional-ready'
  | 'server-unavailable'
  | 'rooms-not-configured'
  | 'match-plan-missing'
  | 'schedule-blocked'
  | 'round-ready'
  | 'round-in-progress'
  | 'results-awaiting-review'
  | 'round-complete'
  | 'rebracket-required'
  | 'next-round-preparation'
  | 'tournament-complete';

export type ReadinessIssueSeverity = 'error' | 'warning';

export interface ITournamentIssue {
  id: string;
  severity: ReadinessIssueSeverity;
  title: string;
  message: string;
  target: ReadinessTarget;
  actionLabel?: string;
  suppressed?: boolean;
  /** A scheduled match or round to focus when the destination is opened. */
  scheduledMatchIds?: string[];
  roundNumber?: number;
  /** Number of raw issues represented by this actionable group. */
  groupedCount?: number;
}

export interface IReadinessSession {
  roomId?: string;
  status?: string;
}

export interface IReadinessServerState {
  running: boolean;
  currentRoundNumber: number | null;
  releasedRoundNumber: number | null;
  inboxCount: number;
  conflictCount?: number;
  sessions?: IReadinessSession[];
  roomPresence?: Array<{ roomId: string; connected: boolean }>;
}

export interface IReadinessAction {
  kind: 'navigate' | 'release-round' | 'open-rebracket' | 'start-server' | 'review-results';
  label: string;
  target?: ReadinessTarget;
  roundNumber?: number;
  phaseCode?: string;
  scheduledMatchIds?: string[];
}

export interface ITournamentReadiness {
  state: TournamentOperationState;
  setup: {
    tournamentReady: boolean;
    rulesReady: boolean;
    teamsReady: boolean;
    formatReady: boolean;
    teamCount: number;
    expectedTeamCount: number | null;
  };
  /** Core setup is enough for the traditional manual-entry workflow. */
  coreReady: boolean;
  /** Room operations are opt-in; an ordinary YellowFruit tournament does not need a Match Plan. */
  roomOperationsEnabled: boolean;
  roomOperations: {
    roomsConfigured: boolean;
    matchPlanConfigured: boolean;
    serverRunning: boolean;
    currentAssignmentsValid: boolean;
  };
  issues: ITournamentIssue[];
  activeIssues: ITournamentIssue[];
  suppressedWarningCount: number;
  primaryAction: IReadinessAction | null;
  currentRoundNumber: number | null;
  currentRoundSummary: ReturnType<typeof summarizeRound> | null;
  rebracketBoundary: Phase | null;
  rebracketNextPhase: Phase | null;
}

function issue(
  id: string,
  severity: ReadinessIssueSeverity,
  title: string,
  message: string,
  target: ReadinessTarget,
  actionLabel?: string,
  extra: Partial<ITournamentIssue> = {},
): ITournamentIssue {
  return { id, severity, title, message, target, actionLabel, ...extra };
}

function allMatches(tournament: Tournament): Match[] {
  return tournament.phases.flatMap((phase) => phase.rounds.flatMap((round) => round.matches));
}

function allScheduledMatches(tournament: Tournament): ScheduledMatch[] {
  return tournament.scheduledMatches.slice();
}

function findRebracketBoundary(tournament: Tournament, scheduledMatches: ScheduledMatch[]): Phase | null {
  const fullPhases = tournament.getFullPhases();
  return (
    fullPhases.find((phase) => {
      const next = tournament.getNextFullPhase(phase);
      if (!next || tournament.rebracketedPhaseCodes.includes(phase.code)) return false;
      const phaseRoundNumbers = phase.rounds.map((round) => round.number);
      const phaseMatches = scheduledMatches.filter((match) => phaseRoundNumbers.includes(match.roundNumber));
      const missing = validatePhaseScheduleCompleteness(phase, scheduledMatches);
      return phaseMatches.length > 0 && phaseMatches.every((match) => match.isResolved()) && missing.length === 0;
    }) ?? null
  );
}

function addScheduleIssues(issues: ITournamentIssue[], scheduleIssues: IScheduleIssue[]) {
  scheduleIssues.forEach((scheduleIssue, index) => {
    const severity: ReadinessIssueSeverity =
      scheduleIssue.severity === ScheduleIssueSeverity.Error ? 'error' : 'warning';
    issues.push(
      issue(
        `schedule-${index}-${scheduleIssue.message}`,
        severity,
        severity === 'error' ? 'Schedule conflict' : 'Schedule needs review',
        scheduleIssue.message,
        'control:match-plan',
        'Open Match Plan',
        { scheduledMatchIds: scheduleIssue.scheduledMatchIds },
      ),
    );
  });
}

function addMatchValidationIssues(issues: ITournamentIssue[], matches: Match[]) {
  matches.forEach((match) => {
    const errors = match.getErrorMessages();
    const warnings = match.getWarningMessages();
    if (errors.length > 0) {
      issues.push(
        issue(
          `match-error-${match.id}`,
          'error',
          'Invalid game data',
          `${match.getScoreString()}: ${errors[0]}`,
          'games',
          'Review game',
        ),
      );
    } else if (warnings.length > 0) {
      issues.push(
        issue(
          `match-warning-${match.id}`,
          'warning',
          'Game warning',
          `${match.getScoreString()}: ${warnings[0]}`,
          'games',
          'Review game',
        ),
      );
    }
  });
}

function countSuppressedWarnings(matches: Match[]): number {
  return matches.reduce((count, match) => count + match.getNumSuppressedWarnings(), 0);
}

function issueGroupKey(currentIssue: ITournamentIssue): string {
  if (currentIssue.title === 'Invalid game data') return 'game-errors';
  if (currentIssue.title === 'Game warning') return 'game-warnings';
  if (currentIssue.title === 'Schedule conflict') return 'schedule-errors';
  if (currentIssue.title === 'Schedule needs review') return 'schedule-warnings';
  return currentIssue.id;
}

function groupedIssueTitle(key: string, count: number): string {
  switch (key) {
    case 'game-errors':
      return `${count} game ${count === 1 ? 'error' : 'errors'}`;
    case 'game-warnings':
      return `${count} game ${count === 1 ? 'warning' : 'warnings'}`;
    case 'schedule-errors':
      return `${count} room assignment ${count === 1 ? 'error' : 'errors'}`;
    case 'schedule-warnings':
      return `${count} schedule ${count === 1 ? 'warning' : 'warnings'}`;
    default:
      return '';
  }
}

function groupedIssueMessage(key: string, count: number): string {
  switch (key) {
    case 'game-errors':
      return 'Game data needs correction before it can be included in a report.';
    case 'game-warnings':
      return 'Review the game warnings when you have a moment.';
    case 'schedule-errors':
      return 'Room assignments or release prerequisites need attention.';
    case 'schedule-warnings':
      return 'Some scheduled games may need a director decision.';
    default:
      return `${count} actionable issue${count === 1 ? '' : 's'}.`;
  }
}

function groupActiveIssues(issues: ITournamentIssue[], currentRoundNumber: number | null): ITournamentIssue[] {
  const active = issues.filter((currentIssue) => !currentIssue.suppressed);
  const groups = new Map<string, ITournamentIssue[]>();
  active.forEach((currentIssue) => {
    const key = issueGroupKey(currentIssue);
    groups.set(key, [...(groups.get(key) ?? []), currentIssue]);
  });

  return [...groups.entries()]
    .map(([key, grouped]) => {
      const first = grouped[0];
      if (grouped.length === 1) return first;
      const scheduledMatchIds = Array.from(
        new Set(grouped.flatMap((currentIssue) => currentIssue.scheduledMatchIds ?? [])),
      );
      return {
        ...first,
        id: `group-${key}`,
        title: groupedIssueTitle(key, grouped.length),
        message: groupedIssueMessage(key, grouped.length),
        actionLabel: first.actionLabel,
        scheduledMatchIds,
        roundNumber: currentRoundNumber ?? first.roundNumber,
        groupedCount: grouped.length,
      };
    })
    .sort((a, b) => {
      let severityOrder = 0;
      if (a.severity !== b.severity) severityOrder = a.severity === 'error' ? -1 : 1;
      if (severityOrder !== 0) return severityOrder;
      const currentRoundOrder =
        (a.roundNumber === currentRoundNumber ? -1 : 0) - (b.roundNumber === currentRoundNumber ? -1 : 0);
      return currentRoundOrder || a.title.localeCompare(b.title);
    });
}

function firstUnresolvedRound(scheduledMatches: ScheduledMatch[]): number | null {
  const unresolved = scheduledMatches.filter((match) => !match.isResolved());
  if (unresolved.length === 0) return null;
  return unresolved.reduce((earliest, match) => Math.min(earliest, match.roundNumber), Infinity);
}

function currentRoundMatches(scheduledMatches: ScheduledMatch[], roundNumber: number | null): ScheduledMatch[] {
  return roundNumber === null ? [] : scheduledMatches.filter((match) => match.roundNumber === roundNumber);
}

function hasRoomOfflineForRound(
  matches: ScheduledMatch[],
  rooms: TournamentRoom[],
  server: IReadinessServerState | undefined,
): boolean {
  if (!server?.running) return false;
  const presence = new Map((server.roomPresence ?? []).map((room) => [room.roomId, room.connected]));
  return matches.some((match) => {
    if (!match.roomId || match.isResolved()) return false;
    const room = rooms.find((candidate) => candidate.id === match.roomId);
    return !!room && room.enabled && presence.has(room.id) && presence.get(room.id) === false;
  });
}

function nextRoundNumber(scheduledMatches: ScheduledMatch[], currentRoundNumber: number | null): number | null {
  if (currentRoundNumber === null) return null;
  return roundsWithGames(scheduledMatches).find((roundNumber) => roundNumber > currentRoundNumber) ?? null;
}

/**
 * Resolve the tournament into one compact operational state.
 *
 * The resolver is deliberately independent of React and the server implementation. It gives every
 * page the same answer about what matters, while `IReadinessServerState` keeps ephemeral sessions
 * outside the tournament file and outside public exports.
 */
export function resolveTournamentReadiness(
  tournament: Tournament,
  server?: IReadinessServerState,
): ITournamentReadiness {
  const teamCount = tournament.getNumberOfTeams();
  const expectedTeamCount = tournament.getExpectedNumberOfTeams();
  const tournamentReady = tournament.name.trim() !== '';
  const rulesReady = tournament.scoringRules.answerTypes.length > 0;
  const teamsReady = teamCount > 0 && (expectedTeamCount === null || teamCount === expectedTeamCount);
  const formatReady = tournament.getFullPhases().some((phase) => phase.rounds.length > 0 && phase.pools.length > 0);
  const setup = { tournamentReady, rulesReady, teamsReady, formatReady, teamCount, expectedTeamCount };
  const issues: ITournamentIssue[] = [];
  const scheduledMatches = allScheduledMatches(tournament);
  const matches = allMatches(tournament);
  const rooms = tournament.rooms.slice();
  const coreReady = tournamentReady && rulesReady && teamsReady && formatReady;
  const roomOperationsEnabled =
    rooms.length > 0 ||
    scheduledMatches.length > 0 ||
    server?.running === true ||
    (server?.inboxCount ?? 0) > 0 ||
    (server?.conflictCount ?? 0) > 0 ||
    (server?.sessions?.length ?? 0) > 0 ||
    (server?.roomPresence?.length ?? 0) > 0 ||
    (server?.releasedRoundNumber !== null && server?.releasedRoundNumber !== undefined);

  if (!tournamentReady) {
    issues.push(
      issue(
        'missing-tournament-name',
        'warning',
        'Tournament details are incomplete',
        'Add a tournament name.',
        'setup:tournament',
        'Open Tournament',
      ),
    );
  }
  if (!rulesReady) {
    issues.push(
      issue(
        'missing-rules',
        'error',
        'Rules are not configured',
        'Choose a standard ruleset or configure custom scoring.',
        'setup:rules',
        'Open Rules',
      ),
    );
  }
  if (teamCount === 0) {
    issues.push(
      issue(
        'missing-teams',
        'error',
        'No teams registered',
        'Add or import the teams that will play.',
        'setup:teams',
        'Open Teams',
      ),
    );
  } else if (expectedTeamCount !== null && teamCount !== expectedTeamCount) {
    issues.push(
      issue(
        'field-size-mismatch',
        'error',
        'Registered field does not fit the format',
        `${teamCount} team${
          teamCount === 1 ? '' : 's'
        } registered; the format provides space for ${expectedTeamCount}.`,
        'setup:teams',
        'Fix Teams',
      ),
    );
  }
  if (!formatReady) {
    issues.push(
      issue(
        'missing-format',
        'error',
        'Tournament format is not configured',
        'Choose a format or create a custom one.',
        'setup:format',
        'Open Format',
      ),
    );
  }

  const scheduleIssues = roomOperationsEnabled ? validateSchedule(scheduledMatches, rooms) : [];
  if (roomOperationsEnabled) addScheduleIssues(issues, scheduleIssues);
  addMatchValidationIssues(issues, matches);

  if (tournament.scoringRules.answerTypes.length > 4) {
    issues.push(
      issue(
        'sqbs-answer-type-limit',
        'warning',
        'SQBS export needs attention',
        'SQBS supports at most four tossup point values; this tournament uses more.',
        'reports',
        'Review exports',
      ),
    );
  }

  const suppressedWarningCount = countSuppressedWarnings(matches);
  if (suppressedWarningCount > 0) {
    issues.push(
      issue(
        'suppressed-warnings',
        'warning',
        'Suppressed warnings remain',
        `${suppressedWarningCount} warning${
          suppressedWarningCount === 1 ? '' : 's'
        } are suppressed in saved game data.`,
        'reports',
        'Review warnings',
        { suppressed: true },
      ),
    );
  }

  if (roomOperationsEnabled && (server?.conflictCount ?? 0) > 0) {
    issues.push(
      issue(
        'submission-conflicts',
        'error',
        'Result conflicts',
        `${server?.conflictCount} submitted result${server?.conflictCount === 1 ? '' : 's'} need a decision.`,
        'control:live',
        'Review conflicts',
      ),
    );
  }
  if (roomOperationsEnabled && (server?.inboxCount ?? 0) > 0) {
    issues.push(
      issue(
        'results-awaiting-review',
        'warning',
        'Results awaiting review',
        `${server?.inboxCount} submitted result${server?.inboxCount === 1 ? '' : 's'} are waiting for review.`,
        'control:live',
        'Review results',
      ),
    );
  }

  const rebracketBoundary = findRebracketBoundary(tournament, scheduledMatches);
  const rebracketNextPhase = rebracketBoundary ? tournament.getNextFullPhase(rebracketBoundary) ?? null : null;
  const currentRoundNumber = roomOperationsEnabled
    ? server?.currentRoundNumber ?? firstUnresolvedRound(scheduledMatches)
    : null;
  const currentMatches = currentRoundMatches(scheduledMatches, currentRoundNumber);
  const currentSummary = currentRoundNumber === null ? null : summarizeRound(scheduledMatches, currentRoundNumber);
  const currentScheduleIssues = scheduleIssues.filter((scheduleIssue) =>
    scheduleIssue.scheduledMatchIds.some((id) => currentMatches.some((match) => match.id === id)),
  );
  const serverRequired = roomOperationsEnabled && (scheduledMatches.length > 0 || rooms.length > 0);
  const serverUnavailable = serverRequired && !!server && !server.running && rooms.length > 0;
  const roomsMissing = roomOperationsEnabled && scheduledMatches.length > 0 && rooms.length === 0;
  const planMissing = roomOperationsEnabled && formatReady && scheduledMatches.length === 0;
  const conflictIds = currentScheduleIssues
    .filter(
      (scheduleIssue) =>
        scheduleIssue.severity === ScheduleIssueSeverity.Error ||
        /not assigned|unassigned/i.test(scheduleIssue.message),
    )
    .flatMap((scheduleIssue) => scheduleIssue.scheduledMatchIds);
  const roomOffline = hasRoomOfflineForRound(currentMatches, rooms, server);
  const currentAssignmentsValid = !scheduleIssues.some((scheduleIssue) => {
    if (scheduleIssue.severity === ScheduleIssueSeverity.Error) return true;
    return currentMatches.some((match) => scheduleIssue.scheduledMatchIds.includes(match.id));
  });
  const conflictsAwaitingDecision = (server?.conflictCount ?? 0) > 0;
  const reviewAwaiting = (server?.inboxCount ?? 0) > 0;
  const nextRound = nextRoundNumber(scheduledMatches, currentRoundNumber);
  const currentInProgress =
    currentSummary !== null &&
    (currentSummary.playing > 0 || (server?.sessions ?? []).some((session) => session.status === 'playing'));
  const currentComplete = currentSummary?.complete === true;

  let state: TournamentOperationState = 'setup';
  let primaryAction: IReadinessAction | null = null;

  if (!coreReady) {
    state = 'setup';
    if (!tournamentReady) primaryAction = { kind: 'navigate', label: 'Open Tournament', target: 'setup:tournament' };
    else if (!rulesReady) primaryAction = { kind: 'navigate', label: 'Open Rules', target: 'setup:rules' };
    else if (!teamsReady) primaryAction = { kind: 'navigate', label: 'Open Teams', target: 'setup:teams' };
    else primaryAction = { kind: 'navigate', label: 'Open Format', target: 'setup:format' };
  } else if (!roomOperationsEnabled) {
    state = 'traditional-ready';
    primaryAction = { kind: 'navigate', label: 'Open Games', target: 'games' };
  } else if (serverUnavailable) {
    state = 'server-unavailable';
    primaryAction = { kind: 'start-server', label: 'Start server', target: 'control:live' };
  } else if (roomsMissing) {
    state = 'rooms-not-configured';
    primaryAction = { kind: 'navigate', label: 'Configure rooms', target: 'control:rooms' };
  } else if (planMissing) {
    state = 'match-plan-missing';
    primaryAction = { kind: 'navigate', label: 'Create Match Plan', target: 'control:match-plan' };
  } else if (conflictsAwaitingDecision) {
    state = 'results-awaiting-review';
    primaryAction = { kind: 'review-results', label: 'Review conflicts', target: 'control:live' };
  } else if (conflictIds.length > 0 || roomOffline) {
    state = 'schedule-blocked';
    primaryAction = {
      kind: 'navigate',
      label: 'Fix assignment',
      target: 'control:match-plan',
      roundNumber: currentRoundNumber ?? undefined,
      scheduledMatchIds: conflictIds,
    };
  } else if (reviewAwaiting) {
    state = 'results-awaiting-review';
    primaryAction = { kind: 'review-results', label: 'Review results', target: 'control:live' };
  } else if (currentComplete) {
    if (rebracketBoundary) {
      state = 'rebracket-required';
      primaryAction = {
        kind: 'open-rebracket',
        label: 'Review standings & rebracket',
        target: 'control:live',
        phaseCode: rebracketBoundary.code,
      };
    } else if (nextRound !== null) {
      state = 'next-round-preparation';
      primaryAction = {
        kind: 'navigate',
        label: `Prepare Round ${nextRound}`,
        target: 'control:match-plan',
        roundNumber: nextRound,
      };
    } else {
      state = 'tournament-complete';
      primaryAction = { kind: 'navigate', label: 'Review reports', target: 'reports' };
    }
  } else if (currentInProgress) {
    state = 'round-in-progress';
  } else if (currentRoundNumber !== null && server?.releasedRoundNumber !== currentRoundNumber) {
    state = 'round-ready';
    primaryAction = {
      kind: 'release-round',
      label: `Release Round ${currentRoundNumber}`,
      target: 'control:live',
      roundNumber: currentRoundNumber,
    };
  } else if (currentRoundNumber !== null) {
    state = 'round-ready';
  }

  if (currentComplete && rebracketBoundary) state = 'rebracket-required';

  const activeIssues = groupActiveIssues(issues, currentRoundNumber);
  return {
    state,
    setup,
    coreReady,
    roomOperationsEnabled,
    roomOperations: {
      roomsConfigured: rooms.length > 0,
      matchPlanConfigured: scheduledMatches.length > 0,
      serverRunning: server?.running === true,
      currentAssignmentsValid,
    },
    issues,
    activeIssues,
    suppressedWarningCount,
    primaryAction,
    currentRoundNumber,
    currentRoundSummary: currentSummary,
    rebracketBoundary,
    rebracketNextPhase,
  };
}

export default resolveTournamentReadiness;
