import { describe, expect, test } from 'vitest';
import { attachScorerRecovery, readScorerRecovery, scorerRecoveryKey } from '../room/scorer/ScorerRecovery';
import deriveGame, { IGameSetup } from '../room/scoring/deriveGame';
import { ScoreEvent } from '../room/scoring/ScoreEvents';
import MatchImportService from '../renderer/Services/MatchImportService';
import { ImportResultStatus } from '../renderer/DataModel/MatchImportResult';
import scoringRulesToScorekeeperFormat from '../renderer/Services/ScorekeeperFormat';
import toQbjMatch from '../room/scoring/toQbjMatch';
import { makeTestTournament, testTeamNames } from './TestFixtures';

const setup: IGameSetup = {
  left: { name: 'Ninety Six', players: ['Sarah'] },
  right: { name: 'Greenwood', players: ['Emma'] },
};
const events: ScoreEvent[] = [
  { id: 'e1', type: 'tossup-buzz', questionNumber: 1, team: 'left', playerName: 'Sarah', answerTypeIndex: 1 },
  { id: 'e2', type: 'bonus', questionNumber: 1, team: 'left', controlledPoints: 20 },
];

describe('first-party QBJ recovery layer', () => {
  test('round-trips the exact setup and event history without credentials', () => {
    const qbj = attachScorerRecovery({ match_teams: [] }, setup, events);
    const recovered = readScorerRecovery(qbj, setup);

    expect(recovered?.setup).toEqual(setup);
    expect(recovered?.events).toEqual(events);
    expect(JSON.stringify(qbj)).not.toMatch(/token|credential|session/i);
  });

  test('refuses a backup for a different matchup', () => {
    const qbj = attachScorerRecovery({}, setup, events);

    expect(readScorerRecovery(qbj, { left: { name: 'Other' }, right: { name: 'Greenwood' } })).toBeNull();
  });

  test.each([
    ['a non-array starting lineup', { ...setup, left: { ...setup.left, startingLineup: 'Sarah' } }],
    ['a blank starting-lineup player', { ...setup, left: { ...setup.left, startingLineup: ['Sarah', ' '] } }],
    ['a duplicate starting-lineup player', { ...setup, left: { ...setup.left, startingLineup: ['Sarah', 'Sarah'] } }],
    ['an unknown starting-lineup player', { ...setup, left: { ...setup.left, startingLineup: ['Sarah', 'Unknown'] } }],
    [
      'a duplicate right starting-lineup player',
      { ...setup, right: { ...setup.right, startingLineup: ['Emma', 'Emma'] } },
    ],
  ])('refuses %s', (_description, malformedSetup) => {
    const qbj = attachScorerRecovery({}, setup, events);
    (qbj as any)[scorerRecoveryKey].setup = malformedSetup;

    expect(readScorerRecovery(qbj, setup)).toBeNull();
  });

  test('refuses unversioned QBJ rather than guessing from aggregates', () => {
    expect(readScorerRecovery({ [scorerRecoveryKey]: { setup, events } }, setup)).toBeNull();
  });

  test('refuses malformed events instead of putting them into the live scorer', () => {
    const qbj = attachScorerRecovery({}, setup, events);
    (qbj as any)[scorerRecoveryKey].events = [{ type: 'tossup-buzz', questionNumber: 'one' }];

    expect(readScorerRecovery(qbj, setup)).toBeNull();
  });

  test.each([
    ['a bonus without a team', { id: 'bad', type: 'bonus', questionNumber: 1, controlledPoints: 20 }],
    ['a bonus without numeric points', { id: 'bad', type: 'bonus', questionNumber: 1, team: 'left' }],
    ['lightning without a team', { id: 'bad', type: 'lightning', questionNumber: 1, points: 40 }],
    ['an adjustment without numeric points', { id: 'bad', type: 'adjustment', questionNumber: 1, team: 'left' }],
    [
      'an empty substitution lineup',
      { id: 'bad', type: 'substitution', questionNumber: 1, team: 'left', activePlayers: [] },
    ],
    [
      'a substitution lineup with a blank name',
      { id: 'bad', type: 'substitution', questionNumber: 1, team: 'left', activePlayers: ['Sarah', ' '] },
    ],
    [
      'a substitution lineup with duplicate names',
      { id: 'bad', type: 'substitution', questionNumber: 1, team: 'left', activePlayers: ['Sarah', 'Sarah'] },
    ],
    [
      'a zero-point tossup with a blank player name',
      { id: 'bad', type: 'tossup-no-penalty', questionNumber: 1, team: 'left', playerName: ' ' },
    ],
  ])('refuses %s', (_description, malformedEvent) => {
    const qbj = attachScorerRecovery({}, setup, events);
    (qbj as any)[scorerRecoveryKey].events = [malformedEvent];

    expect(readScorerRecovery(qbj, setup)).toBeNull();
  });
});

describe('a recovery-bearing payload is still an ordinary QBJ match', () => {
  test('YellowFruit imports it, and the extra key disturbs none of the aggregates', () => {
    // The recovery layer rides on the payload rooms actually submit, so the thing worth proving is
    // that the desktop still reads the game rather than that the layer round-trips on its own.
    const tournament = makeTestTournament();
    const format = scoringRulesToScorekeeperFormat(tournament.scoringRules);
    const gameSetup: IGameSetup = {
      left: { name: testTeamNames[0], players: [`${testTeamNames[0]} Player 1`] },
      right: { name: testTeamNames[1], players: [`${testTeamNames[1]} Player 1`] },
    };
    const played: ScoreEvent[] = [
      {
        id: 'a',
        type: 'tossup-buzz',
        questionNumber: 1,
        team: 'left',
        playerName: `${testTeamNames[0]} Player 1`,
        answerTypeIndex: 1,
      },
      { id: 'b', type: 'bonus', questionNumber: 1, team: 'left', controlledPoints: 20 },
    ];
    for (let question = 2; question <= 20; question += 1) {
      played.push({ id: `d${question}`, type: 'tossup-dead', questionNumber: question });
    }

    const game = deriveGame(format, gameSetup, played);
    const withRecovery = attachScorerRecovery(toQbjMatch(format, game, { round: 1 }), gameSetup, played);

    const { results } = new MatchImportService(tournament).importMatches([
      { filePath: 'Room 204 (session test)', fileContents: JSON.stringify(withRecovery) },
    ]);

    expect(results[0].status).toBe(ImportResultStatus.Success);
    expect(results[0].messages).toEqual([]);
    expect(results[0].match?.leftTeam.points).toBe(30);
    expect(results[0].match?.tossupsRead).toBe(20);
  });
});
