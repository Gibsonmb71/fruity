import { ApplicationPages, ControlPages, SetupPages } from '../Enums';
import Tournament from '../DataModel/Tournament';
import { ReadinessTarget } from './TournamentReadiness';

export interface IQuickFindItem {
  id: string;
  label: string;
  detail: string;
  target: ReadinessTarget;
  navigation?: IQuickFindNavigation;
}

export interface IQuickFindNavigation {
  matchId?: string;
  teamName?: string;
  roundNumber?: number;
}

const pageItems: IQuickFindItem[] = [
  { id: 'page-setup', label: 'Setup', detail: 'Tournament configuration', target: 'setup:tournament' },
  { id: 'page-games', label: 'Games', detail: 'Manual game entry and history', target: 'games' },
  { id: 'page-live', label: 'Control · Live', detail: 'Current round and result inbox', target: 'control:live' },
  {
    id: 'page-match-plan',
    label: 'Control · Match Plan',
    detail: 'Pairings, rooms, and assignments',
    target: 'control:match-plan',
  },
  { id: 'page-rooms', label: 'Control · Rooms', detail: 'Room setup and server', target: 'control:rooms' },
  { id: 'page-reports', label: 'Reports', detail: 'Standings and exports', target: 'reports' },
];

export function buildQuickFindItems(tournament: Tournament): IQuickFindItem[] {
  const roundTarget = tournament.scheduledMatches.length > 0 ? ('control:match-plan' as const) : ('games' as const);
  const teamItems = tournament.getListOfAllTeams().map((team) => ({
    id: `team-${team.id}`,
    label: team.name,
    detail: 'Team',
    target: 'games' as const,
    navigation: { teamName: team.name },
  }));
  const roomItems = tournament.rooms.map((room) => ({
    id: `room-${room.id}`,
    label: room.name,
    detail: room.enabled ? 'Room · enabled' : 'Room · disabled',
    target: 'control:rooms' as const,
  }));
  const roundItems = tournament.phases.flatMap((phase) =>
    phase.rounds.map((round) => ({
      id: `round-${phase.code}-${round.number}`,
      label: round.displayName(),
      detail: phase.name,
      target: roundTarget,
      navigation: { roundNumber: round.number },
    })),
  );
  const scheduledItems = tournament.scheduledMatches.map((match) => ({
    id: `scheduled-${match.id}`,
    label: `${match.leftTeamName} vs ${match.rightTeamName}`,
    detail: `Round ${match.roundNumber} · Match Plan`,
    target: 'control:match-plan' as const,
  }));
  const playedItems = tournament.phases.flatMap((phase) =>
    phase.rounds.flatMap((round) =>
      round.matches.map((match) => ({
        id: `match-${match.id}`,
        label: match.getScoreString(),
        detail: `${phase.name} · ${round.displayName()}`,
        target: 'games' as const,
        navigation: { matchId: match.id, roundNumber: round.number },
      })),
    ),
  );
  return [...pageItems, ...teamItems, ...roomItems, ...roundItems, ...scheduledItems, ...playedItems];
}

export function filterQuickFindItems(items: IQuickFindItem[], query: string): IQuickFindItem[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (normalized === '') return items.slice(0, 12);
  return items
    .map((item) => {
      const label = item.label.toLocaleLowerCase();
      const detail = item.detail.toLocaleLowerCase();
      const index = label.indexOf(normalized);
      const detailIndex = detail.indexOf(normalized);
      if (index === -1 && detailIndex === -1) return null;
      let score = 3;
      if (index >= 0) score = index === 0 ? 0 : 1;
      else if (detailIndex === 0) score = 2;
      return { item, score, index: index >= 0 ? index : detailIndex };
    })
    .filter((result): result is { item: IQuickFindItem; score: number; index: number } => result !== null)
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
