import { describe, expect, test } from 'vitest';
import scoringRulesToScorekeeperFormat, { IScorekeeperFormat } from '../renderer/Services/ScorekeeperFormat';
import { CommonRuleSets, ScoringRules } from '../renderer/DataModel/ScoringRules';
import deriveGame, { IGameSetup } from '../room/scoring/deriveGame';
import toQbjMatch from '../room/scoring/toQbjMatch';
import {
  editableQuestionFromEvents,
  eventsFromEditableQuestion,
  replaceQuestionEvents,
  validateEditableQuestion,
} from '../room/scoring/questionCorrection';
import { ScoreEvent } from '../room/scoring/ScoreEvents';
import { event } from './RoomScoreEventFixtures';

const setup: IGameSetup = {
  left: { name: 'Ninety Six', players: ['Sarah', 'James'] },
  right: { name: 'Greenwood', players: ['Emma', 'Jordan'] },
};

function formatFor(): IScorekeeperFormat {
  const rules = new ScoringRules(CommonRuleSets.AcfPowers);
  rules.maximumPlayersPerTeam = 2;
  return scoringRulesToScorekeeperFormat(rules);
}

describe('question-level corrections', () => {
  test('round-trips a complete question and keeps non-scoring audit events', () => {
    const format = formatFor();
    const events: ScoreEvent[] = [
      event({ type: 'tossup-buzz', questionNumber: 1, team: 'left', playerName: 'Sarah', answerTypeIndex: 1 }),
      event({ type: 'bonus', questionNumber: 1, team: 'left', controlledPoints: 20 }),
      event({ type: 'note', questionNumber: 1, text: 'Reader checked the ruling.', flagged: true }),
      event({
        type: 'protest',
        questionNumber: 1,
        team: 'right',
        subject: 'tossup-answer',
        description: 'Review requested',
        status: 'open',
      }),
    ];
    const model = editableQuestionFromEvents(events, 1);
    const corrected = {
      ...model,
      attempts: [{ ...model.attempts[0], answerTypeIndex: 0 }],
    };

    expect(validateEditableQuestion(format, deriveGame(format, setup, events), corrected)).toEqual([]);
    let correctionId = 0;
    const replacement = eventsFromEditableQuestion(corrected, () => `replacement-${++correctionId}`);
    const next = replaceQuestionEvents(events, 1, replacement);

    expect(next.map((candidate) => candidate.type)).toEqual(['tossup-buzz', 'bonus', 'note', 'protest']);
    expect(next.find((candidate) => candidate.type === 'tossup-buzz')).toMatchObject({ answerTypeIndex: 0 });
    expect(next.find((candidate) => candidate.type === 'note')).toMatchObject({ flagged: true });
    const correctedGame = deriveGame(format, setup, next);
    expect(correctedGame.left.points).toBe(35);
    const qbj = toQbjMatch(format, correctedGame) as {
      match_teams?: { points: number }[];
      match_questions?: { buzzes: { result: { value: number } }[] }[];
    };
    expect(qbj.match_teams?.[0].points).toBe(35);
    expect(qbj.match_questions?.[0].buzzes[0].result.value).toBe(15);
  });

  test('inserting a corrected question without existing cycle events preserves question order', () => {
    const events: ScoreEvent[] = [
      event({ type: 'tossup-dead', questionNumber: 1 }),
      event({ type: 'note', questionNumber: 1, text: 'First question' }),
      event({ type: 'tossup-dead', questionNumber: 3 }),
    ];
    let correctionId = 0;
    const replacement = eventsFromEditableQuestion(
      { questionNumber: 2, attempts: [], dead: true },
      () => `replacement-${++correctionId}`,
    );

    const next = replaceQuestionEvents(events, 2, replacement);

    expect(next.map((candidate) => candidate.questionNumber)).toEqual([1, 1, 2, 3]);
    expect(next[2].type).toBe('tossup-dead');
  });

  test('a dead question cannot also contain a zero-point answer', () => {
    const format = formatFor();
    const game = deriveGame(format, setup, [event({ type: 'tossup-dead', questionNumber: 1 })]);
    const errors = validateEditableQuestion(format, game, {
      questionNumber: 1,
      attempts: [{ kind: 'no-penalty', team: 'left', playerName: 'Sarah' }],
      dead: true,
    });

    expect(errors[0]).toContain('answer and No buzz');
  });
});
