import { ApplicationPages, ControlPages, SetupPages } from '../Enums';
import Tournament from '../DataModel/Tournament';
import { ScheduledMatchStatus } from '../DataModel/ScheduledMatch';
import { ReadinessTarget } from './TournamentReadiness';
import { INavigationIntent } from './Navigation';
import { validateSchedule } from './ScheduleService';

export type QuickFindCategory = 'PAGE' | 'TEAM' | 'GAME' | 'SCHEDULED GAME' | 'ROUND' | 'ROOM' | 'ACTION';
export type QuickFindAction =
  | 'add-game'
  | 'add-team'
  | 'open-games'
  | 'open-current-round'
  | 'open-match-plan'
  | 'open-rooms'
  | 'open-reports'
  | 'open-live-display'
  | 'start-server'
  | 'review-results'
  | 'release-round';

export interface IQuickFindItem {
  id: string;
  label: string;
  detail: string;
  target: ReadinessTarget;
  category: QuickFindCategory;
  actionId?: QuickFindAction;
  navigation: IQuickFindNavigation;
}

export type IQuickFindNavigation = INavigationIntent;

export interface IQuickFindContext {
  serverRunning?: boolean;
  inboxCount?: number;
  currentRoundNumber?: number | null;
  /** A caller with the full readiness resolver can make the release decision authoritative. */
  releaseAllowed?: boolean;
}

interface IItemOptions {
  id: string;
  category: QuickFindCategory;
  label: string;
  detail: string;
  target: ReadinessTarget;
  actionId?: QuickFindAction;
  navigation?: Omit<INavigationIntent, 'target'>;
}

function item(options: IItemOptions): IQuickFindItem {
  const { navigation, target, ...rest } = options;
  return {
    ...rest,
    target,
    navigation: { target, ...navigation },
  };
}

const pageItems: IQuickFindItem[] = [
  item({
    id: 'page-setup',
    category: 'PAGE',
    label: 'Setup',
    detail: 'Tournament configuration',
    target: 'setup:tournament',
  }),
  item({
    id: 'page-games',
    category: 'PAGE',
    label: 'Games',
    detail: 'Manual game entry and history',
    target: 'games',
  }),
  item({
    id: 'page-live',
    category: 'PAGE',
    label: 'Control / Live',
    detail: 'Current round and result inbox',
    target: 'control:live',
  }),
  item({
    id: 'page-match-plan',
    category: 'PAGE',
    label: 'Control / Match Plan',
    detail: 'Pairings, rooms, and assignments',
    target: 'control:match-plan',
  }),
  item({
    id: 'page-rooms',
    category: 'PAGE',
    label: 'Control / Rooms',
    detail: 'Room setup and server',
    target: 'control:rooms',
  }),
  item({
    id: 'page-display',
    category: 'PAGE',
    label: 'Control / Display',
    detail: 'Public live display settings',
    target: 'control:display',
  }),
  item({
    id: 'page-reports',
    category: 'PAGE',
    label: 'Reports',
    detail: 'Standings and exports',
    target: 'reports',
  }),
];

function firstUnresolvedRound(tournament: Tournament, context: IQuickFindContext): number | undefined {
  if (context.currentRoundNumber !== undefined && context.currentRoundNumber !== null) {
    return context.currentRoundNumber;
  }
  const scheduledRound = tournament.scheduledMatches
    .filter((match) => !match.isResolved())
    .sort((a, b) => a.roundNumber - b.roundNumber)[0]?.roundNumber;
  if (scheduledRound !== undefined) return scheduledRound;
  return tournament.phases
    .flatMap((phase) => phase.rounds)
    .find((round) => round.matches.some((match) => match.getErrorMessages().length > 0 || match.getWarningMessages().length > 0))
    ?.number;
}

function canReleaseRound(tournament: Tournament, roundNumber: number, context: IQuickFindContext): boolean {
  if (context.releaseAllowed !== undefined) return context.releaseAllowed;
  const matches = tournament.scheduledMatches.filter(
    (match) => match.roundNumber === roundNumber && match.status !== ScheduledMatchStatus.Cancelled,
  );
  if (matches.length === 0 || matches.some((match) => !match.roomId)) return false;
  return !validateSchedule(matches, tournament.rooms).some((issue) => issue.severity === 'error');
}

export function buildQuickFindItems(tournament: Tournament, context: IQuickFindContext = {}): IQuickFindItem[] {
  const browserScoring = tournament.roomScoringMode === 'browser';
  const currentRound = firstUnresolvedRound(tournament, context);
  const roundTarget = browserScoring ? ('control:match-plan' as const) : ('games' as const);
  const actions: IQuickFindItem[] = [
    item({
      id: 'action-add-game',
      category: 'ACTION',
      actionId: 'add-game',
      label: 'Add game',
      detail: 'Open Games entry',
      target: 'games',
    }),
    item({
      id: 'action-add-team',
      category: 'ACTION',
      actionId: 'add-team',
      label: 'Add team',
      detail: 'Open Setup / Teams',
      target: 'setup:teams',
    }),
    item({
      id: 'action-open-games',
      category: 'ACTION',
      actionId: 'open-games',
      label: 'Open Games',
      detail: 'Manual game entry and history',
      target: 'games',
    }),
    item({
      id: 'action-open-current-round',
      category: 'ACTION',
      actionId: 'open-current-round',
      label: 'Open current round',
      detail: 'Open the first unresolved round',
      target: roundTarget,
      navigation: currentRound === undefined ? {} : { roundNumber: currentRound, focus: 'round' },
    }),
    item({
      id: 'action-open-match-plan',
      category: 'ACTION',
      actionId: 'open-match-plan',
      label: 'Open Match Plan',
      detail: 'Pairings and room assignments',
      target: 'control:match-plan',
    }),
    item({
      id: 'action-open-rooms',
      category: 'ACTION',
      actionId: 'open-rooms',
      label: 'Open Rooms',
      detail: 'Room setup and server',
      target: 'control:rooms',
    }),
    item({
      id: 'action-open-reports',
      category: 'ACTION',
      actionId: 'open-reports',
      label: 'Open Reports',
      detail: 'Standings and exports',
      target: 'reports',
    }),
    item({
      id: 'action-open-live-display',
      category: 'ACTION',
      actionId: 'open-live-display',
      label: 'Open Live Display',
      detail: 'Public display settings',
      target: 'control:display',
    }),
  ];

  if (browserScoring && context.serverRunning !== true) {
    actions.push(
      item({
        id: 'action-start-server',
        category: 'ACTION',
        actionId: 'start-server',
        label: 'Start Tournament Server',
        detail: 'Open Control / Live',
        target: 'control:live',
      }),
    );
  }

  const submittedCount = tournament.scheduledMatches.filter(
    (match) => match.status === ScheduledMatchStatus.Submitted,
  ).length;
  if (browserScoring && (submittedCount > 0 || (context.inboxCount ?? 0) > 0)) {
    actions.push(
      item({
        id: 'action-review-results',
        category: 'ACTION',
        actionId: 'review-results',
        label: 'Review submitted results',
        detail: `${Math.max(submittedCount, context.inboxCount ?? 0)} result${
          Math.max(submittedCount, context.inboxCount ?? 0) === 1 ? '' : 's'
        } waiting in Control / Live`,
        target: 'control:live',
        navigation: { focus: 'result-inbox', controlFocus: 'inbox' },
      }),
    );
  }

  if (browserScoring && currentRound !== undefined && canReleaseRound(tournament, currentRound, context)) {
    actions.push(
      item({
        id: `action-release-round-${currentRound}`,
        category: 'ACTION',
        actionId: 'release-round',
        label: `Release Round ${currentRound}`,
        detail: 'Make the current round available to rooms',
        target: 'control:live',
        navigation: { roundNumber: currentRound, focus: 'round', controlFocus: 'current-round' },
      }),
    );
  }

  const teamItems = tournament.getListOfAllTeams().map((team) =>
    item({
      id: `team-${team.id}`,
      category: 'TEAM',
      label: team.name,
      detail: 'Team',
      target: 'games',
      navigation: { teamName: team.name },
    }),
  );
  const roomItems = tournament.rooms.map((room) =>
    item({
      id: `room-${room.id}`,
      category: 'ROOM',
      label: room.name,
      detail: room.enabled ? 'Room · enabled' : 'Room · disabled',
      target: 'control:rooms',
      navigation: { roomId: room.id, focus: 'room' },
    }),
  );
  const roundItems = tournament.phases.flatMap((phase) =>
    phase.rounds.map((round) =>
      item({
        id: `round-${phase.code}-${round.number}`,
        category: 'ROUND',
        label: round.displayName(),
        detail: phase.name,
        target: roundTarget,
        navigation: { roundNumber: round.number, phaseCode: phase.code, focus: 'round' },
      }),
    ),
  );
  const scheduledItems = tournament.scheduledMatches.map((match) =>
    item({
      id: `scheduled-${match.id}`,
      category: 'SCHEDULED GAME',
      label: `${match.leftTeamName} vs ${match.rightTeamName}`,
      detail: `Scheduled · Round ${match.roundNumber} · ${match.phaseCode || 'Match Plan'}`,
      target: 'control:match-plan',
      navigation: {
        scheduledMatchId: match.id,
        scheduledMatchIds: [match.id],
        roundNumber: match.roundNumber,
        phaseCode: match.phaseCode,
        focus: 'scheduled-match',
        controlFocus: 'match-plan',
      },
    }),
  );
  const playedItems = tournament.phases.flatMap((phase) =>
    phase.rounds.flatMap((round) =>
      round.matches.map((match) =>
        item({
          id: `match-${match.id}`,
          category: 'GAME',
          label: match.getScoreString(),
          detail: `${phase.name} · ${round.displayName()}`,
          target: 'games',
          navigation: {
            matchId: match.id,
            roundNumber: round.number,
            gamesReviewFilter:
              match.getErrorMessages().length > 0 || match.getWarningMessages().length > 0
                ? ('needs-review' as const)
                : ('all' as const),
            focus: 'scheduled-match',
          },
        }),
      ),
    ),
  );
  return [...actions, ...pageItems, ...teamItems, ...roomItems, ...roundItems, ...scheduledItems, ...playedItems];
}

export function filterQuickFindItems(items: IQuickFindItem[], query: string): IQuickFindItem[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (normalized === '') return items.slice(0, 12);
  return items
    .map((currentItem) => {
      const label = currentItem.label.toLocaleLowerCase();
      const detail = currentItem.detail.toLocaleLowerCase();
      const category = currentItem.category.toLocaleLowerCase();
      const index = label.indexOf(normalized);
      const detailIndex = detail.indexOf(normalized);
      const categoryIndex = category.indexOf(normalized);
      if (index === -1 && detailIndex === -1 && categoryIndex === -1) return null;
      let score = 3;
      if (index >= 0) score = index === 0 ? 0 : 1;
      else if (detailIndex >= 0) score = detailIndex === 0 ? 2 : 3;
      else score = 4;
      return { item: currentItem, score, index: index >= 0 ? index : detailIndex >= 0 ? detailIndex : categoryIndex };
    })
    .filter(
      (result): result is { item: IQuickFindItem; score: number; index: number } => result !== null,
    )
    .sort((a, b) => a.score - b.score || a.index - b.index || a.item.label.localeCompare(b.item.label))
    .map((result) => result.item)
    .slice(0, 30);
}

export function quickFindTargetForPage(
  page: ApplicationPages,
  controlSection: ControlPages,
  setupSection: SetupPages,
): ReadinessTarget {
  if (page === ApplicationPages.Games) return 'games';
  if (page === ApplicationPages.Reports) return 'reports';
  if (page === ApplicationPages.Control) {
    if (controlSection === ControlPages.MatchPlan) return 'control:match-plan';
    if (controlSection === ControlPages.Rooms) return 'control:rooms';
    if (controlSection === ControlPages.Display) return 'control:display';
    return 'control:live';
  }
  if (setupSection === SetupPages.Rules) return 'setup:rules';
  if (setupSection === SetupPages.Teams) return 'setup:teams';
  if (setupSection === SetupPages.Format) return 'setup:format';
  return 'setup:tournament';
}
