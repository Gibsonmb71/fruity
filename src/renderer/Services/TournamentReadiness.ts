import { Phase } from '../DataModel/Phase';
import { Match } from '../DataModel/Match';
import { ScheduledMatch } from '../DataModel/ScheduledMatch';
import Tournament from '../DataModel/Tournament';
import { TournamentRoom } from '../DataModel/TournamentRoom';
import { createNavigationIntent, INavigationIntent, INavigationPayload } from './Navigation';
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
  navigation?: INavigationIntent;
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
  roomPresence?: Array<{ roomId: string; connected: boolean; readyDeviceCount?: number }>;
  inboxScheduledMatchIds?: string[];
}

export interface IReadinessAction {
  kind: 'navigate' | 'release-round' | 'open-rebracket' | 'start-server' | 'review-results';
  label: string;
  target?: ReadinessTarget;
  roundNumber?: number;
  phaseCode?: string;
  scheduledMatchIds?: string[];
  navigation?: INavigationIntent;
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
    configuredRoomCount: number;
    configuredRoomsConnected: boolean;
    configuredRoomsReady: boolean;
    connectedRoomCount: number;
    readyRoomCount: number;
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
  extra: Omit<Partial<ITournamentIssue>, 'navigation'> & { navigation?: INavigationPayload } = {},
): ITournamentIssue {
  const { navigation, ...rest } = extra;
  return {
    id,
    severity,
    title,
    message,
    target,
    actionLabel,
    ...rest,
    navigation: createNavigationIntent(target, {
      ...navigation,
      roundNumber: rest.roundNumber,
      scheduledMatchIds: rest.scheduledMatchIds,
      scheduledMatchId: rest.scheduledMatchIds?.[0],
    }),
  };
}

function readinessAction(
  kind: IReadinessAction['kind'],
  label: string,
  target: ReadinessTarget,
  payload: INavigationPayload = {},
): IReadinessAction {
  const action: IReadinessAction = {
    kind,
    label,
    target,
    navigation: createNavigationIntent(target, payload),
  };
  if (payload.roundNumber !== undefined) action.roundNumber = payload.roundNumber;
  if (payload.phaseCode !== undefined) action.phaseCode = payload.phaseCode;
  if (payload.scheduledMatchIds !== undefined) action.scheduledMatchIds = payload.scheduledMatchIds;
  return action;
}

function allMatches(tournament: Tournament): Match[] {
  return tournament.phases.flatMap((phase) => phase.rounds.flatMap((round) => round.matches));
}

function matchRounds(tournament: Tournament): Map<string, number> {
  return new Map(
    tournament.phases
      .flatMap((phase) => phase.rounds.map((round) => round.matches.map((match) => [match.id, round.number] as const)))
      .flat(),
  );
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

function addScheduleIssues(
  issues: ITournamentIssue[],
  scheduleIssues: IScheduleIssue[],
  roundByScheduledMatchId: Map<string, number>,
) {
  scheduleIssues.forEach((scheduleIssue, index) => {
    const severity: ReadinessIssueSeverity =
      scheduleIssue.severity === ScheduleIssueSeverity.Error ? 'error' : 'warning';
    const roundNumber = roundByScheduledMatchId.get(scheduleIssue.scheduledMatchIds[0]);
    issues.push(
      issue(
        `schedule-${index}-${scheduleIssue.message}`,
        severity,
        severity === 'error' ? 'Schedule conflict' : 'Schedule needs review',
        scheduleIssue.message,
        'control:match-plan',
        'Open Match Plan',
        {
          scheduledMatchIds: scheduleIssue.scheduledMatchIds,
          roundNumber,
          navigation: {
            scheduledMatchIds: scheduleIssue.scheduledMatchIds,
            scheduledMatchId: scheduleIssue.scheduledMatchIds[0],
            roundNumber,
            focus: 'scheduled-match',
          },
        },
      ),
    );
  });
}

function addMatchValidationIssues(issues: ITournamentIssue[], matches: Match[], roundByMatchId: Map<string, number>) {
  matches.forEach((match) => {
    const errors = match.getErrorMessages();
    const warnings = match.getWarningMessages();
    const roundNumber = roundByMatchId.get(match.id);
    if (errors.length > 0) {
      issues.push(
        issue(
          `match-error-${match.id}`,
          'error',
          'Invalid game data',
          `${match.getScoreString()}: ${errors[0]}`,
          'games',
          'Review game',
          {
            roundNumber,
            navigation: { matchId: match.id, roundNumber, gamesReviewFilter: 'errors', focus: 'round' },
          },
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
          {
            roundNumber,
            navigation: { matchId: match.id, roundNumber, gamesReviewFilter: 'warnings', focus: 'round' },
          },
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
      const groupedMatchIds = Array.from(
        new Set(grouped.map((currentIssue) => currentIssue.navigation?.matchId).filter((id): id is string => !!id)),
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
        navigation: createNavigationIntent(first.target, {
          matchId: grouped.length === 1 ? first.navigation?.matchId : undefined,
          matchIds: grouped.length === 1 ? first.navigation?.matchIds : groupedMatchIds,
          scheduledMatchIds,
          scheduledMatchId: first.navigation?.scheduledMatchId ?? scheduledMatchIds[0],
          teamName: first.navigation?.teamName,
          phaseCode: first.navigation?.phaseCode,
          roomId: first.navigation?.roomId,
          gamesReviewFilter: first.navigation?.gamesReviewFilter,
          focus: first.navigation?.focus,
          roundNumber: currentRoundNumber ?? first.navigation?.roundNumber ?? first.roundNumber,
        }),
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
  const roundByMatchId = matchRounds(tournament);
  const roundByScheduledMatchId = new Map(scheduledMatches.map((match) => [match.id, match.roundNumber]));
  const rooms = tournament.rooms.slice();
  const coreReady = tournamentReady && rulesReady && teamsReady && formatReady;
  const roomOperationsEnabled = tournament.roomScoringMode === 'browser';
  const configuredRooms = rooms.filter((room) => room.enabled);
  const presenceByRoom = new Map((server?.roomPresence ?? []).map((presence) => [presence.roomId, presence]));
  const connectedRoomCount = configuredRooms.filter((room) => presenceByRoom.get(room.id)?.connected === true).length;
  const readyRoomCount = configuredRooms.filter(
    (room) => (presenceByRoom.get(room.id)?.readyDeviceCount ?? 0) > 0,
  ).length;
  const configuredRoomsConnected = configuredRooms.length === 0 || connectedRoomCount === configuredRooms.length;
  const configuredRoomsReady = configuredRooms.length === 0 || readyRoomCount === configuredRooms.length;

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
  if (roomOperationsEnabled) addScheduleIssues(issues, scheduleIssues, roundByScheduledMatchId);
  addMatchValidationIssues(issues, matches, roundByMatchId);

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
        { navigation: { focus: 'result-inbox', scheduledMatchId: server?.inboxScheduledMatchIds?.[0] } },
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
        { navigation: { focus: 'result-inbox', scheduledMatchId: server?.inboxScheduledMatchIds?.[0] } },
      ),
    );
  }
  if (roomOperationsEnabled && server?.running && configuredRooms.length > 0 && !configuredRoomsConnected) {
    issues.push(
      issue(
        'rooms-not-connected',
        'warning',
        'Room browsers are not all connected',
        `${configuredRooms.length - connectedRoomCount} configured room${
          configuredRooms.length - connectedRoomCount === 1 ? '' : 's'
        } need to open /join and pair before browser scoring starts.`,
        'control:rooms',
        'Open Rooms',
      ),
    );
  }
  if (roomOperationsEnabled && server?.running && configuredRooms.length > 0 && !configuredRoomsReady) {
    issues.push(
      issue(
        'rooms-not-ready',
        'warning',
        'Room operators are not all ready',
        `${configuredRooms.length - readyRoomCount} configured room${
          configuredRooms.length - readyRoomCount === 1 ? '' : 's'
        } still need a scorekeeper to mark Ready.`,
        'control:rooms',
        'Open Rooms',
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
    if (!tournamentReady) primaryAction = readinessAction('navigate', 'Open Tournament', 'setup:tournament');
    else if (!rulesReady) primaryAction = readinessAction('navigate', 'Open Rules', 'setup:rules');
    else if (!teamsReady) primaryAction = readinessAction('navigate', 'Open Teams', 'setup:teams');
    else primaryAction = readinessAction('navigate', 'Open Format', 'setup:format');
  } else if (!roomOperationsEnabled) {
    state = 'traditional-ready';
    primaryAction = readinessAction('navigate', 'Open Games', 'games');
  } else if (serverUnavailable) {
    state = 'server-unavailable';
    primaryAction = readinessAction('start-server', 'Start server', 'control:live');
  } else if (roomsMissing) {
    state = 'rooms-not-configured';
    primaryAction = readinessAction('navigate', 'Configure rooms', 'control:rooms');
  } else if (planMissing) {
    state = 'match-plan-missing';
    primaryAction = readinessAction('navigate', 'Create Match Plan', 'control:match-plan');
  } else if (conflictsAwaitingDecision) {
    state = 'results-awaiting-review';
    primaryAction = readinessAction('review-results', 'Review conflicts', 'control:live', {
      focus: 'result-inbox',
      scheduledMatchId: server?.inboxScheduledMatchIds?.[0],
    });
  } else if (conflictIds.length > 0 || roomOffline) {
    state = 'schedule-blocked';
    primaryAction = readinessAction('navigate', 'Fix assignment', 'control:match-plan', {
      focus: 'scheduled-match',
      scheduledMatchIds: conflictIds,
      scheduledMatchId: conflictIds[0],
      roundNumber: currentRoundNumber ?? undefined,
    });
  } else if (reviewAwaiting) {
    state = 'results-awaiting-review';
    primaryAction = readinessAction('review-results', 'Review results', 'control:live', {
      focus: 'result-inbox',
      scheduledMatchId: server?.inboxScheduledMatchIds?.[0],
    });
  } else if (currentComplete) {
    if (rebracketBoundary) {
      state = 'rebracket-required';
      primaryAction = readinessAction('open-rebracket', 'Review standings & rebracket', 'control:live', {
        phaseCode: rebracketBoundary.code,
      });
    } else if (nextRound !== null) {
      state = 'next-round-preparation';
      primaryAction = readinessAction('navigate', `Prepare Round ${nextRound}`, 'control:match-plan', {
        roundNumber: nextRound,
      });
    } else {
      state = 'tournament-complete';
      primaryAction = readinessAction('navigate', 'Review reports', 'reports');
    }
  } else if (currentInProgress) {
    state = 'round-in-progress';
  } else if (currentRoundNumber !== null && server?.releasedRoundNumber !== currentRoundNumber) {
    state = 'round-ready';
    primaryAction = readinessAction('release-round', `Release Round ${currentRoundNumber}`, 'control:live', {
      roundNumber: currentRoundNumber,
    });
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
      configuredRoomCount: configuredRooms.length,
      configuredRoomsConnected,
      configuredRoomsReady,
      connectedRoomCount,
      readyRoomCount,
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
