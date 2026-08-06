import { describe, expect, test } from 'vitest';
import { Match } from '../renderer/DataModel/Match';
import { MatchValidationType } from '../renderer/DataModel/MatchValidationMessage';
import { ValidationStatuses } from '../renderer/DataModel/Interfaces';
import { ScheduledMatch } from '../renderer/DataModel/ScheduledMatch';
import { buildQuickFindItems } from '../renderer/Services/QuickFind';
import { resolveTournamentReadiness } from '../renderer/Services/TournamentReadiness';
import { makeTestTournament, testTeamNames } from './TestFixtures';

describe('structured navigation intents', () => {
  test('single game validation issues retain game, round, and review context', () => {
    const tournament = makeTestTournament();
    const round = tournament.phases[0].rounds[0];
    const left = tournament.findTeamByName(testTeamNames[0]);
    const right = tournament.findTeamByName(testTeamNames[1]);
    if (!left || !right) throw new Error('test teams were not created');
    const match = new Match(left, right, tournament.scoringRules.answerTypes);
    match.modalBottomValidation.addValidationMsg(
      MatchValidationType.TeamPlayingItself,
      ValidationStatuses.Error,
      'A team cannot play itself',
    );
    round.addMatch(match);

    const issue = resolveTournamentReadiness(tournament).issues.find(
      (candidate) => candidate.id === `match-error-${match.id}`,
    );

    expect(issue?.navigation).toMatchObject({
      target: 'games',
      matchId: match.id,
      roundNumber: round.number,
      gamesReviewFilter: 'errors',
    });
  });

  test('grouped warnings carry the review filter and all exact games', () => {
    const tournament = makeTestTournament();
    const round = tournament.phases[0].rounds[0];
    const left = tournament.findTeamByName(testTeamNames[0]);
    const right = tournament.findTeamByName(testTeamNames[1]);
    if (!left || !right) throw new Error('test teams were not created');
    for (let index = 0; index < 2; index += 1) {
      const match = new Match(left, right, tournament.scoringRules.answerTypes);
      match.modalBottomValidation.addValidationMsg(
        MatchValidationType.LowTotalTuh,
        ValidationStatuses.Warning,
        `Warning ${index + 1}`,
      );
      round.addMatch(match);
    }

    const group = resolveTournamentReadiness(tournament).activeIssues.find(
      (issue) => issue.id === 'group-game-warnings',
    );

    expect(group?.title).toBe('2 game warnings');
    expect(group?.navigation).toMatchObject({ target: 'games', gamesReviewFilter: 'warnings' });
    expect(group?.navigation?.matchIds).toHaveLength(2);
  });

  test('room assignment issues retain the round and scheduled match ids', () => {
    const tournament = makeTestTournament();
    tournament.roomScoringMode = 'browser';
    const scheduled = new ScheduledMatch(1, testTeamNames[0], testTeamNames[1], 'scheduled-navigation-1');
    scheduled.phaseCode = tournament.getPrelimPhase()?.code ?? '1';
    tournament.scheduledMatches = [scheduled];

    const issue = resolveTournamentReadiness(tournament).activeIssues.find(
      (candidate) => candidate.target === 'control:match-plan',
    );

    expect(issue?.navigation).toMatchObject({
      target: 'control:match-plan',
      roundNumber: 1,
      scheduledMatchId: scheduled.id,
      scheduledMatchIds: [scheduled.id],
    });
  });

  test('Quick Find preserves exact scheduled-match and current-round context', () => {
    const tournament = makeTestTournament();
    tournament.roomScoringMode = 'browser';
    const scheduled = new ScheduledMatch(1, testTeamNames[0], testTeamNames[1], 'scheduled-quick-find-1');
    scheduled.phaseCode = tournament.getPrelimPhase()?.code ?? '1';
    scheduled.roomId = 'room-101';
    tournament.scheduledMatches = [scheduled];

    const items = buildQuickFindItems(tournament, { currentRoundNumber: 1, serverRunning: true });
    const scheduledItem = items.find((item) => item.id === `scheduled-${scheduled.id}`);
    const currentRound = items.find((item) => item.actionId === 'open-current-round');

    expect(scheduledItem?.navigation).toMatchObject({
      target: 'control:match-plan',
      scheduledMatchId: scheduled.id,
      roundNumber: 1,
    });
    expect(currentRound?.navigation).toMatchObject({ target: 'control:match-plan', roundNumber: 1 });
  });
});
