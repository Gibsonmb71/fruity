/**
 * The scoring engine, exercised across the formats YellowFruit can actually represent.
 *
 * The property under test throughout is that nothing is format-specific. Every case below is the
 * same code path with different rules handed to it.
 */
import { describe, expect, test } from 'vitest';
import scoringRulesToScorekeeperFormat, { IScorekeeperFormat } from '../renderer/Services/ScorekeeperFormat';
import { CommonRuleSets, ScoringRules } from '../renderer/DataModel/ScoringRules';
import AnswerType from '../renderer/DataModel/AnswerType';
import deriveGame, { IGameSetup } from '../room/scoring/deriveGame';
import { ScoreEvent } from '../room/scoring/ScoreEvents';

const setup: IGameSetup = {
  left: { name: 'Ninety Six', players: ['Sarah', 'James', 'Alex', 'Taylor'] },
  right: { name: 'Greenwood', players: ['Emma', 'Jordan', 'Morgan', 'Casey'] },
};

function formatFor(mutate: (rules: ScoringRules) => void = () => {}): IScorekeeperFormat {
  const rules = new ScoringRules(CommonRuleSets.AcfPowers);
  mutate(rules);
  return scoringRulesToScorekeeperFormat(rules);
}

/** Index of the answer type worth this many points. */
function typeIndex(format: IScorekeeperFormat, value: number): number {
  const found = format.answerTypes.find((at) => at.value === value);
  if (!found) throw new Error(`No answer type worth ${value}`);
  return found.index;
}

let nextId = 0;
function buzz(questionNumber: number, team: 'left' | 'right', playerName: string, answerTypeIndex: number): ScoreEvent {
  nextId += 1;
  return { id: `e${nextId}`, type: 'tossup-buzz', questionNumber, team, playerName, answerTypeIndex };
}
function dead(questionNumber: number): ScoreEvent {
  nextId += 1;
  return { id: `e${nextId}`, type: 'tossup-dead', questionNumber };
}
function bonus(
  questionNumber: number,
  team: 'left' | 'right',
  controlledPoints: number,
  bouncebackPoints?: number,
): ScoreEvent {
  nextId += 1;
  return { id: `e${nextId}`, type: 'bonus', questionNumber, team, controlledPoints, bouncebackPoints };
}

/** Play a straightforward converted tossup plus bonus. */
function convertedCycle(
  format: IScorekeeperFormat,
  questionNumber: number,
  team: 'left' | 'right',
  playerName: string,
  value: number,
  bonusPoints: number,
): ScoreEvent[] {
  return [buzz(questionNumber, team, playerName, typeIndex(format, value)), bonus(questionNumber, team, bonusPoints)];
}

describe('a single tossup', () => {
  test('a converted tossup and its bonus produce the right score', () => {
    const format = formatFor();
    const game = deriveGame(format, setup, convertedCycle(format, 1, 'left', 'Sarah', 15, 20));

    expect(game.left.points).toBe(35);
    expect(game.left.tossupPoints).toBe(15);
    expect(game.left.bonusPoints).toBe(20);
    expect(game.right.points).toBe(0);
  });

  test('the buzzing player gets the points and the answer count', () => {
    const format = formatFor();
    const game = deriveGame(format, setup, convertedCycle(format, 1, 'left', 'Sarah', 15, 20));

    const sarah = game.left.players.find((p) => p.name === 'Sarah')!;
    expect(sarah.points).toBe(15);
    expect(sarah.answerCounts.get(typeIndex(format, 15))).toBe(1);
    expect(game.left.players.find((p) => p.name === 'James')!.points).toBe(0);
  });

  test('a dead tossup scores nothing but is still heard', () => {
    const format = formatFor();
    const game = deriveGame(format, setup, [dead(1)]);

    expect(game.left.points).toBe(0);
    expect(game.tossupsRead).toBe(1);
    expect(game.left.players.find((p) => p.name === 'Sarah')!.tossupsHeard).toBe(1);
  });

  test('every active player on both teams hears the tossup', () => {
    const format = formatFor();
    const game = deriveGame(format, setup, convertedCycle(format, 1, 'left', 'Sarah', 15, 20));

    for (const team of [game.left, game.right]) {
      for (const player of team.players) expect(player.tossupsHeard, player.name).toBe(1);
    }
  });
});

describe('multi-attempt tossups', () => {
  test('a neg does not end the tossup; the other team may still answer', () => {
    const format = formatFor();
    const events = [buzz(1, 'left', 'Sarah', typeIndex(format, -5))];

    const game = deriveGame(format, setup, events);

    expect(game.phase).toEqual({ kind: 'tossup', questionNumber: 1, period: 'regulation', eligibleTeams: ['right'] });
    expect(game.questions[0].resolved).toBe(false);
  });

  test('a neg then a conversion by the other team scores both', () => {
    const format = formatFor();
    const game = deriveGame(format, setup, [
      buzz(1, 'left', 'Sarah', typeIndex(format, -5)),
      buzz(1, 'right', 'Emma', typeIndex(format, 10)),
      bonus(1, 'right', 20),
    ]);

    expect(game.left.points).toBe(-5);
    expect(game.right.points).toBe(30);
    expect(game.questions[0].resolved).toBe(true);
  });

  test('both teams negging ends the tossup, because nobody is left to ask', () => {
    const format = formatFor();
    const game = deriveGame(format, setup, [
      buzz(1, 'left', 'Sarah', typeIndex(format, -5)),
      buzz(1, 'right', 'Emma', typeIndex(format, -5)),
    ]);

    expect(game.questions[0].resolved).toBe(true);
    expect(game.phase.kind).toBe('tossup');
    expect(game.phase).toMatchObject({ questionNumber: 2 });
    expect(game.tossupsRead).toBe(1);
  });

  test('a format with two negs treats both as negs', () => {
    const format = formatFor((rules) => {
      rules.answerTypes = [new AnswerType(10), new AnswerType(-5), new AnswerType(-10)];
    });
    const game = deriveGame(format, setup, [
      buzz(1, 'left', 'Sarah', typeIndex(format, -10)),
      buzz(1, 'right', 'Emma', typeIndex(format, -5)),
    ]);

    expect(game.left.points).toBe(-10);
    expect(game.right.points).toBe(-5);
    expect(game.questions[0].resolved).toBe(true);
  });
});

describe('bonus phase', () => {
  test('a conversion moves straight into the bonus without being asked to', () => {
    const format = formatFor();
    const game = deriveGame(format, setup, [buzz(1, 'left', 'Sarah', typeIndex(format, 10))]);

    expect(game.phase).toEqual({ kind: 'bonus', questionNumber: 1, period: 'regulation', team: 'left' });
  });

  test('with bonuses off, a conversion goes straight to the next tossup', () => {
    const format = formatFor((rules) => rules.setUseBonuses(false));
    const game = deriveGame(format, setup, [buzz(1, 'left', 'Sarah', typeIndex(format, 10))]);

    expect(game.phase).toMatchObject({ kind: 'tossup', questionNumber: 2 });
    expect(game.left.bonusesHeard).toBe(0);
  });

  test('a neg never earns a bonus', () => {
    const format = formatFor();
    const game = deriveGame(format, setup, [
      buzz(1, 'left', 'Sarah', typeIndex(format, -5)),
      buzz(1, 'right', 'Emma', typeIndex(format, -5)),
    ]);

    expect(game.phase).toMatchObject({ kind: 'tossup' });
    expect(game.left.bonusesHeard).toBe(0);
    expect(game.right.bonusesHeard).toBe(0);
  });

  test('bonuses heard counts conversions, matching MatchTeam.getBonusesHeard', () => {
    const format = formatFor();
    const game = deriveGame(format, setup, [
      ...convertedCycle(format, 1, 'left', 'Sarah', 15, 20),
      ...convertedCycle(format, 2, 'left', 'James', 10, 30),
      ...convertedCycle(format, 3, 'right', 'Emma', 10, 10),
    ]);

    expect(game.left.bonusesHeard).toBe(2);
    expect(game.right.bonusesHeard).toBe(1);
    expect(game.left.bonusPoints).toBe(50);
  });

  test('an irregular bonus is recorded as a total', () => {
    // No pointsPerPart, so there is nothing to collect part by part.
    const format = formatFor((rules) => {
      rules.pointsPerBonusPart = undefined;
      rules.minimumPartsPerBonus = 2;
      rules.maximumPartsPerBonus = 5;
      rules.maximumBonusScore = 50;
    });
    const game = deriveGame(format, setup, convertedCycle(format, 1, 'left', 'Sarah', 10, 25));

    expect(format.bonus.regular).toBe(false);
    expect(game.left.bonusPoints).toBe(25);
    expect(game.left.points).toBe(35);
  });

  test('a bonus given per part totals the parts', () => {
    const format = formatFor();
    nextId += 1;
    const game = deriveGame(format, setup, [
      buzz(1, 'left', 'Sarah', typeIndex(format, 10)),
      {
        id: `e${nextId}`,
        type: 'bonus',
        questionNumber: 1,
        team: 'left',
        parts: [{ controlledPoints: 10 }, { controlledPoints: 0 }, { controlledPoints: 10 }],
      },
    ]);

    expect(game.left.bonusPoints).toBe(20);
  });
});

describe('bouncebacks', () => {
  test('bounceback points go to the other team', () => {
    const format = formatFor((rules) => {
      rules.bonusesBounceBack = true;
    });
    const game = deriveGame(format, setup, [buzz(1, 'left', 'Sarah', typeIndex(format, 10)), bonus(1, 'left', 20, 10)]);

    expect(game.left.bonusPoints).toBe(20);
    expect(game.left.points).toBe(30);
    expect(game.right.bonusBouncebackPoints).toBe(10);
    expect(game.right.points).toBe(10);
  });

  test('per-part bouncebacks total correctly', () => {
    const format = formatFor((rules) => {
      rules.bonusesBounceBack = true;
    });
    nextId += 1;
    const game = deriveGame(format, setup, [
      buzz(1, 'left', 'Sarah', typeIndex(format, 10)),
      {
        id: `e${nextId}`,
        type: 'bonus',
        questionNumber: 1,
        team: 'left',
        parts: [
          { controlledPoints: 10, bouncebackPoints: 0 },
          { controlledPoints: 0, bouncebackPoints: 10 },
          { controlledPoints: 0, bouncebackPoints: 10 },
        ],
      },
    ]);

    expect(game.left.bonusPoints).toBe(10);
    expect(game.right.bonusBouncebackPoints).toBe(20);
  });
});

describe('lightning rounds', () => {
  test('a lightning total is added to the team score', () => {
    const format = formatFor((rules) => {
      rules.lightningCountPerTeam = 1;
    });
    nextId += 1;
    const game = deriveGame(format, setup, [
      ...convertedCycle(format, 1, 'left', 'Sarah', 10, 20),
      { id: `e${nextId}`, type: 'lightning', questionNumber: 1, team: 'left', points: 60 },
    ]);

    expect(game.left.lightningPoints).toBe(60);
    expect(game.left.points).toBe(90);
  });

  test('a second lightning entry corrects the first rather than adding to it', () => {
    // YellowFruit keeps one lightning total per team, so re-entering it is a correction.
    const format = formatFor((rules) => {
      rules.lightningCountPerTeam = 1;
    });
    const game = deriveGame(format, setup, [
      { id: 'l1', type: 'lightning', questionNumber: 1, team: 'left', points: 60 },
      { id: 'l2', type: 'lightning', questionNumber: 1, team: 'left', points: 40 },
    ]);

    expect(game.left.lightningPoints).toBe(40);
  });
});

describe('substitutions', () => {
  test('only active players hear a tossup', () => {
    const format = formatFor((rules) => {
      rules.maximumPlayersPerTeam = 2;
    });
    const game = deriveGame(format, { ...setup }, [dead(1)]);

    expect(game.left.players.find((p) => p.name === 'Sarah')!.tossupsHeard).toBe(1);
    expect(game.left.players.find((p) => p.name === 'Alex')!.tossupsHeard).toBe(0);
  });

  test('a substitution moves tossups heard to the player who came on', () => {
    const format = formatFor((rules) => {
      rules.maximumPlayersPerTeam = 2;
    });
    const game = deriveGame(format, setup, [
      dead(1),
      dead(2),
      { id: 's1', type: 'substitution', questionNumber: 3, team: 'left', activePlayers: ['Sarah', 'Alex'] },
      dead(3),
      dead(4),
    ]);

    expect(game.left.players.find((p) => p.name === 'Sarah')!.tossupsHeard).toBe(4);
    expect(game.left.players.find((p) => p.name === 'James')!.tossupsHeard).toBe(2);
    expect(game.left.players.find((p) => p.name === 'Alex')!.tossupsHeard).toBe(2);
  });

  test('the substitution applies from its own question, not the one after', () => {
    const format = formatFor((rules) => {
      rules.maximumPlayersPerTeam = 1;
    });
    const game = deriveGame(format, setup, [
      { id: 's1', type: 'substitution', questionNumber: 1, team: 'left', activePlayers: ['James'] },
      dead(1),
    ]);

    expect(game.left.players.find((p) => p.name === 'James')!.tossupsHeard).toBe(1);
    expect(game.left.players.find((p) => p.name === 'Sarah')!.tossupsHeard).toBe(0);
  });
});

describe('regulation and overtime', () => {
  /** Play `count` dead tossups, which is the quickest way to a tied game. */
  function deadTossups(count: number, from = 1): ScoreEvent[] {
    return Array.from({ length: count }, (_, i) => dead(from + i));
  }

  test('an untimed game ends when regulation is played out and somebody is ahead', () => {
    const format = formatFor();
    const game = deriveGame(format, setup, [
      ...convertedCycle(format, 1, 'left', 'Sarah', 10, 20),
      ...deadTossups(19, 2),
    ]);

    expect(game.tossupsRead).toBe(20);
    expect(game.regulationComplete).toBe(true);
    expect(game.phase).toEqual({ kind: 'complete', reason: 'regulation' });
  });

  test('a tie at the end of regulation goes to overtime rather than ending', () => {
    const format = formatFor();
    const game = deriveGame(format, setup, deadTossups(20));

    expect(game.regulationComplete).toBe(true);
    expect(game.phase).toEqual({
      kind: 'tossup',
      questionNumber: 21,
      period: 'overtime',
      eligibleTeams: ['left', 'right'],
    });
  });

  test('sudden death ends the moment somebody scores', () => {
    const format = formatFor((rules) => {
      rules.minimumOvertimeQuestionCount = 1;
    });
    const game = deriveGame(format, setup, [
      ...deadTossups(20),
      ...convertedCycle(format, 21, 'left', 'Sarah', 10, 20),
    ]);

    expect(game.phase).toEqual({ kind: 'complete', reason: 'overtime' });
    expect(game.overtimeTossupsRead).toBe(1);
  });

  test('a three-tossup overtime period is played out even once somebody leads', () => {
    // The score is only consulted at the end of a period, which is what NAQT-style overtime does.
    const format = formatFor((rules) => {
      rules.minimumOvertimeQuestionCount = 3;
    });
    const game = deriveGame(format, setup, [
      ...deadTossups(20),
      ...convertedCycle(format, 21, 'left', 'Sarah', 10, 20),
    ]);

    expect(game.phase).toMatchObject({ kind: 'tossup', questionNumber: 22, period: 'overtime' });
  });

  test('after a full overtime period, a lead ends the game', () => {
    const format = formatFor((rules) => {
      rules.minimumOvertimeQuestionCount = 3;
    });
    const game = deriveGame(format, setup, [
      ...deadTossups(20),
      ...convertedCycle(format, 21, 'left', 'Sarah', 10, 20),
      dead(22),
      dead(23),
    ]);

    expect(game.overtimeTossupsRead).toBe(3);
    expect(game.phase).toEqual({ kind: 'complete', reason: 'overtime' });
  });

  test('still tied after a period means another period', () => {
    const format = formatFor((rules) => {
      rules.minimumOvertimeQuestionCount = 3;
    });
    const game = deriveGame(format, setup, deadTossups(23));

    expect(game.phase).toMatchObject({ kind: 'tossup', questionNumber: 24, period: 'overtime' });
  });

  test('overtime excludes bonuses when the format says so', () => {
    const format = formatFor((rules) => {
      rules.minimumOvertimeQuestionCount = 1;
      rules.overtimeIncludesBonuses = false;
    });
    const game = deriveGame(format, setup, [...deadTossups(20), buzz(21, 'left', 'Sarah', typeIndex(format, 10))]);

    // No bonus phase, and the conversion doesn't count as a bonus heard.
    expect(game.phase).toEqual({ kind: 'complete', reason: 'overtime' });
    expect(game.left.bonusesHeard).toBe(0);
  });

  test('overtime includes bonuses when the format says so', () => {
    const format = formatFor((rules) => {
      rules.minimumOvertimeQuestionCount = 1;
      rules.overtimeIncludesBonuses = true;
    });
    const game = deriveGame(format, setup, [...deadTossups(20), buzz(21, 'left', 'Sarah', typeIndex(format, 10))]);

    expect(game.phase).toEqual({ kind: 'bonus', questionNumber: 21, period: 'overtime', team: 'left' });
    expect(game.left.bonusesHeard).toBe(1);
  });

  test('overtime buzzes are counted separately, as the Match model needs', () => {
    const format = formatFor((rules) => {
      rules.minimumOvertimeQuestionCount = 1;
    });
    const game = deriveGame(format, setup, [...deadTossups(20), buzz(21, 'left', 'Sarah', typeIndex(format, 10))]);

    expect(game.left.overtimeBuzzes.get(typeIndex(format, 10))).toBe(1);
    expect(game.right.overtimeBuzzes.size).toBe(0);
  });
});

describe('timed formats', () => {
  test('regulation does not end on a tossup count', () => {
    const format = formatFor((rules) => {
      rules.timed = true;
    });
    const game = deriveGame(
      format,
      setup,
      Array.from({ length: 25 }, (_, i) => dead(i + 1)),
    );

    expect(game.regulationComplete).toBe(false);
    expect(game.phase).toMatchObject({ kind: 'tossup', questionNumber: 26, period: 'regulation' });
  });

  test('the moderator calling time ends regulation', () => {
    const format = formatFor((rules) => {
      rules.timed = true;
    });
    const game = deriveGame(format, setup, [
      ...convertedCycle(format, 1, 'left', 'Sarah', 10, 20),
      dead(2),
      { id: 'end', type: 'end-regulation', questionNumber: 2 },
    ]);

    expect(game.regulationComplete).toBe(true);
    expect(game.phase).toEqual({ kind: 'complete', reason: 'regulation' });
  });

  test('time called on a tied game still goes to overtime', () => {
    const format = formatFor((rules) => {
      rules.timed = true;
      rules.minimumOvertimeQuestionCount = 1;
    });
    const game = deriveGame(format, setup, [dead(1), { id: 'end', type: 'end-regulation', questionNumber: 1 }]);

    expect(game.phase).toMatchObject({ kind: 'tossup', questionNumber: 2, period: 'overtime' });
  });
});

describe('forfeits', () => {
  test('a single forfeit ends the game', () => {
    const format = formatFor();
    const game = deriveGame(format, setup, [{ id: 'f', type: 'forfeit', questionNumber: 1, teams: ['right'] }]);

    expect(game.right.forfeited).toBe(true);
    expect(game.left.forfeited).toBe(false);
    expect(game.phase).toEqual({ kind: 'complete', reason: 'forfeit' });
  });

  test('a double forfeit marks both teams', () => {
    const format = formatFor();
    const game = deriveGame(format, setup, [{ id: 'f', type: 'forfeit', questionNumber: 1, teams: ['left', 'right'] }]);

    expect(game.left.forfeited).toBe(true);
    expect(game.right.forfeited).toBe(true);
    expect(game.phase).toEqual({ kind: 'complete', reason: 'forfeit' });
  });

  test('a forfeit ends the game even with a bonus outstanding', () => {
    const format = formatFor();
    const game = deriveGame(format, setup, [
      buzz(1, 'left', 'Sarah', typeIndex(format, 10)),
      { id: 'f', type: 'forfeit', questionNumber: 1, teams: ['right'] },
    ]);

    expect(game.phase).toEqual({ kind: 'complete', reason: 'forfeit' });
  });
});

describe('undo and correction', () => {
  test('dropping the last event undoes exactly that action', () => {
    const format = formatFor();
    const events = convertedCycle(format, 1, 'left', 'Sarah', 15, 20);

    const after = deriveGame(format, setup, events);
    const undone = deriveGame(format, setup, events.slice(0, -1));

    expect(after.left.points).toBe(35);
    expect(undone.left.points).toBe(15);
    expect(undone.phase).toEqual({ kind: 'bonus', questionNumber: 1, period: 'regulation', team: 'left' });
  });

  test('editing an earlier question recalculates everything downstream', () => {
    const format = formatFor();
    const events = [
      ...convertedCycle(format, 1, 'left', 'Sarah', 15, 20),
      ...convertedCycle(format, 2, 'left', 'James', 10, 30),
    ];
    expect(deriveGame(format, setup, events).left.points).toBe(75);

    // Sarah's 15 was really a 10, and the bonus was 0.
    const corrected = events.map((event) => {
      if (event.type === 'tossup-buzz' && event.questionNumber === 1) {
        return { ...event, answerTypeIndex: typeIndex(format, 10) };
      }
      if (event.type === 'bonus' && event.questionNumber === 1) return { ...event, controlledPoints: 0 };
      return event;
    });

    const game = deriveGame(format, setup, corrected);

    expect(game.left.points).toBe(50);
    expect(game.left.players.find((p) => p.name === 'Sarah')!.answerCounts.get(typeIndex(format, 15))).toBeUndefined();
  });

  test('a manual adjustment is recorded as itself and reaches the score', () => {
    const format = formatFor();
    const game = deriveGame(format, setup, [
      ...convertedCycle(format, 1, 'left', 'Sarah', 10, 20),
      { id: 'adj', type: 'adjustment', questionNumber: 1, team: 'left', points: 5, reason: 'Agreed with control' },
    ]);

    expect(game.left.adjustmentPoints).toBe(5);
    expect(game.left.points).toBe(35);
  });
});

describe('notes', () => {
  test('notes and flags are collected without affecting the score', () => {
    const format = formatFor();
    const game = deriveGame(format, setup, [
      dead(1),
      { id: 'n1', type: 'note', questionNumber: 12, text: 'possible protest', flagged: true },
      { id: 'n2', type: 'note', questionNumber: 1, text: 'late start' },
    ]);

    expect(game.notes).toEqual([
      { questionNumber: 12, text: 'possible protest', flagged: true },
      { questionNumber: 1, text: 'late start', flagged: false },
    ]);
    expect(game.left.points).toBe(0);
  });
});

describe('formats MODAQ refuses', () => {
  test('7-point tossups with a -3 neg score normally', () => {
    const format = formatFor((rules) => {
      rules.answerTypes = [new AnswerType(7), new AnswerType(-3)];
      rules.setUseBonuses(false);
    });
    const game = deriveGame(format, setup, [
      buzz(1, 'left', 'Sarah', typeIndex(format, -3)),
      buzz(1, 'right', 'Emma', typeIndex(format, 7)),
    ]);

    expect(game.left.points).toBe(-3);
    expect(game.right.points).toBe(7);
  });

  test('a five-value format with two power tiers and two negs', () => {
    const format = formatFor((rules) => {
      rules.answerTypes = [
        new AnswerType(25),
        new AnswerType(20),
        new AnswerType(10),
        new AnswerType(-5),
        new AnswerType(-10),
      ];
    });
    const game = deriveGame(format, setup, [
      ...convertedCycle(format, 1, 'left', 'Sarah', 25, 30),
      buzz(2, 'right', 'Emma', typeIndex(format, -10)),
      ...convertedCycle(format, 2, 'left', 'James', 20, 10),
    ]);

    expect(game.left.points).toBe(85);
    expect(game.right.points).toBe(-10);
  });

  test('a four-part 40-point bonus with bouncebacks and lightning, all at once', () => {
    const format = formatFor((rules) => {
      rules.minimumPartsPerBonus = 4;
      rules.maximumPartsPerBonus = 4;
      rules.pointsPerBonusPart = 10;
      rules.maximumBonusScore = 40;
      rules.bonusesBounceBack = true;
      rules.lightningCountPerTeam = 1;
      rules.lightningDivisor = 5;
    });
    const game = deriveGame(format, setup, [
      buzz(1, 'left', 'Sarah', typeIndex(format, 10)),
      bonus(1, 'left', 30, 10),
      { id: 'lt', type: 'lightning', questionNumber: 1, team: 'right', points: 45 },
    ]);

    expect(game.left.points).toBe(40);
    expect(game.right.points).toBe(55);
  });
});

describe('robustness', () => {
  test('no events at all is a game about to start', () => {
    const format = formatFor();
    const game = deriveGame(format, setup, []);

    expect(game.left.points).toBe(0);
    expect(game.tossupsRead).toBe(0);
    expect(game.phase).toEqual({
      kind: 'tossup',
      questionNumber: 1,
      period: 'regulation',
      eligibleTeams: ['left', 'right'],
    });
  });

  test('a buzz referencing an answer type the format no longer has is ignored, not guessed at', () => {
    const format = formatFor();
    const game = deriveGame(format, setup, [buzz(1, 'left', 'Sarah', 99)]);

    expect(game.left.points).toBe(0);
    expect(game.questions[0].buzzes).toHaveLength(0);
  });

  test('a buzz from somebody not on the roster still counts', () => {
    // Losing points because a roster was incomplete would be worse than an unexpected name.
    const format = formatFor();
    const game = deriveGame(format, setup, [
      buzz(1, 'left', 'Substitute', typeIndex(format, 10)),
      bonus(1, 'left', 20),
    ]);

    expect(game.left.points).toBe(30);
    expect(game.left.players.find((p) => p.name === 'Substitute')!.points).toBe(10);
  });

  test('deriving twice from the same events gives the same answer', () => {
    const format = formatFor();
    const events = [
      ...convertedCycle(format, 1, 'left', 'Sarah', 15, 20),
      buzz(2, 'right', 'Emma', typeIndex(format, -5)),
      ...convertedCycle(format, 2, 'left', 'James', 10, 30),
      dead(3),
    ];

    const first = deriveGame(format, setup, events);
    const second = deriveGame(format, setup, events);

    expect(second.left.points).toBe(first.left.points);
    expect(second.right.points).toBe(first.right.points);
    expect(second.phase).toEqual(first.phase);
  });
});
