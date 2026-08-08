/**
 * A game scored in the browser, imported by the desktop.
 *
 * Every case here goes the whole way: events → derived game → QBJ → `MatchImportService` → a real
 * `Match`. Asserting on the QBJ text alone would only prove the serializer agrees with itself; the
 * thing worth knowing is that YellowFruit accepts it and reads back the numbers the room meant.
 *
 * Several formats below are ones the MODAQ adapter refuses outright, which is the point: they could
 * not be scored in a browser at all before.
 */
import { describe, expect, test } from 'vitest';
import MatchImportService from '../renderer/Services/MatchImportService';
import { ImportResultStatus } from '../renderer/DataModel/MatchImportResult';
import Tournament from '../renderer/DataModel/Tournament';
import { Match } from '../renderer/DataModel/Match';
import { Player } from '../renderer/DataModel/Player';
import { CommonRuleSets, ScoringRules } from '../renderer/DataModel/ScoringRules';
import AnswerType from '../renderer/DataModel/AnswerType';
import scoringRulesToScorekeeperFormat, { IScorekeeperFormat } from '../renderer/Services/ScorekeeperFormat';
import deriveGame, { IGameSetup } from '../room/scoring/deriveGame';
import { ScoreEvent } from '../room/scoring/ScoreEvents';
import toQbjMatch from '../room/scoring/toQbjMatch';
import { makeTestTournament, testTeamNames } from './TestFixtures';
import { event } from './RoomScoreEventFixtures';

const [leftTeamName, rightTeamName] = testTeamNames;

function rosterFor(teamName: string): string[] {
  return [1, 2, 3, 4].map((i) => `${teamName} Player ${i}`);
}

const setup: IGameSetup = {
  left: { name: leftTeamName, players: rosterFor(leftTeamName) },
  right: { name: rightTeamName, players: rosterFor(rightTeamName) },
};

/** A tournament and the matching room-side descriptor, so both halves agree on the rules. */
function tournamentAndFormat(mutate: (rules: ScoringRules) => void = () => {}): {
  tournament: Tournament;
  format: IScorekeeperFormat;
} {
  const tournament = makeTestTournament();
  mutate(tournament.scoringRules);
  return { tournament, format: scoringRulesToScorekeeperFormat(tournament.scoringRules) };
}

function typeIndex(format: IScorekeeperFormat, value: number): number {
  const found = format.answerTypes.find((at) => at.value === value);
  if (!found) throw new Error(`No answer type worth ${value}`);
  return found.index;
}

function buzz(questionNumber: number, team: 'left' | 'right', playerName: string, answerTypeIndex: number) {
  return event({ type: 'tossup-buzz', questionNumber, team, playerName, answerTypeIndex });
}
function dead(questionNumber: number) {
  return event({ type: 'tossup-dead', questionNumber });
}
function bonus(questionNumber: number, team: 'left' | 'right', controlledPoints: number, bouncebackPoints?: number) {
  return event({ type: 'bonus', questionNumber, team, controlledPoints, bouncebackPoints });
}

/** Score the game, serialize it, and hand it to YellowFruit. */
function roundTrip(
  tournament: Tournament,
  format: IScorekeeperFormat,
  events: ScoreEvent[],
  round = 1,
): { match: Match; messages: string[]; status: ImportResultStatus } {
  const game = deriveGame(format, setup, events);
  const qbj = toQbjMatch(format, game, { round, location: 'Room 204' });
  const { results } = new MatchImportService(tournament).importMatches([
    { filePath: 'Room 204 (session test)', fileContents: JSON.stringify(qbj) },
  ]);

  expect(results).toHaveLength(1);
  const [result] = results;
  if (!result.match) throw new Error(`Import produced no match: ${result.messages.join(' / ')}`);
  return { match: result.match, messages: result.messages, status: result.status };
}

/** Fill out a game to a full regulation with dead tossups, so nothing is left half-played. */
function padToRegulation(events: ScoreEvent[], through: number, from: number): ScoreEvent[] {
  const padding: ScoreEvent[] = [];
  for (let q = from; q <= through; q += 1) padding.push(dead(q));
  return events.concat(padding);
}

describe('a standard game', () => {
  const scored = () => {
    const { tournament, format } = tournamentAndFormat();
    const events = padToRegulation(
      [
        buzz(1, 'left', `${leftTeamName} Player 1`, typeIndex(format, 15)),
        bonus(1, 'left', 20),
        buzz(2, 'right', `${rightTeamName} Player 1`, typeIndex(format, 10)),
        bonus(2, 'right', 30),
        buzz(3, 'left', `${leftTeamName} Player 2`, typeIndex(format, -5)),
        buzz(3, 'right', `${rightTeamName} Player 2`, typeIndex(format, 10)),
        bonus(3, 'right', 10),
      ],
      20,
      4,
    );
    return roundTrip(tournament, format, events);
  };

  test('imports cleanly', () => {
    const { status, messages } = scored();

    expect(messages).toEqual([]);
    expect(status).toBe(ImportResultStatus.Success);
  });

  test('the team scores survive', () => {
    const { match } = scored();

    // Left: 15 + 20 bonus - 5 neg = 30. Right: 10 + 30 + 10 + 10 = 60.
    expect(match.leftTeam.points).toBe(30);
    expect(match.rightTeam.points).toBe(60);
  });

  test('bonus points come back out as the room put them in', () => {
    const { match } = scored();

    expect(match.leftTeam.getBonusPoints()).toBe(20);
    expect(match.rightTeam.getBonusPoints()).toBe(40);
    expect(match.leftTeam.getBonusesHeard(new ScoringRules(CommonRuleSets.AcfPowers))).toBe(1);
  });

  test('tossups read and player tossups heard survive', () => {
    const { match } = scored();

    expect(match.tossupsRead).toBe(20);
    for (const matchPlayer of match.leftTeam.matchPlayers) {
      expect(matchPlayer.tossupsHeard, matchPlayer.player.name).toBe(20);
    }
  });

  test('answer counts land on the right players', () => {
    const { match } = scored();

    const byName = (team: typeof match.leftTeam, name: string) =>
      team.matchPlayers.find((mp) => mp.player.name === name)!;

    const scorer = byName(match.leftTeam, `${leftTeamName} Player 1`);
    expect(scorer.answerCounts.find((ac) => ac.answerType.value === 15)?.number).toBe(1);
    expect(scorer.points).toBe(15);

    const negger = byName(match.leftTeam, `${leftTeamName} Player 2`);
    expect(negger.answerCounts.find((ac) => ac.answerType.value === -5)?.number).toBe(1);
  });

  test('the round and the room come through', () => {
    const { match } = scored();

    expect(match.location).toBe('Room 204');
  });

  test('YellowFruit considers the imported game valid for stats', () => {
    const { match } = scored();

    expect(match.getErrorMessages()).toEqual([]);
  });
});

describe('bouncebacks', () => {
  test('bounceback points reach the opposing team', () => {
    const { tournament, format } = tournamentAndFormat((rules) => {
      rules.bonusesBounceBack = true;
    });
    const events = padToRegulation(
      [buzz(1, 'left', `${leftTeamName} Player 1`, typeIndex(format, 10)), bonus(1, 'left', 20, 10)],
      20,
      2,
    );

    const { match } = roundTrip(tournament, format, events);

    expect(match.leftTeam.points).toBe(30);
    expect(match.leftTeam.getBonusPoints()).toBe(20);
    expect(match.rightTeam.bonusBouncebackPoints).toBe(10);
    expect(match.rightTeam.points).toBe(10);
  });
});

describe('formats MODAQ cannot represent', () => {
  test('a 7-point tossup with a -3 neg and no bonuses', () => {
    const { tournament, format } = tournamentAndFormat((rules) => {
      rules.answerTypes = [new AnswerType(7), new AnswerType(-3)];
      rules.setUseBonuses(false);
    });
    const events = padToRegulation(
      [
        buzz(1, 'left', `${leftTeamName} Player 1`, typeIndex(format, 7)),
        buzz(2, 'right', `${rightTeamName} Player 1`, typeIndex(format, -3)),
        buzz(2, 'left', `${leftTeamName} Player 1`, typeIndex(format, 7)),
      ],
      20,
      3,
    );

    const { match, messages } = roundTrip(tournament, format, events);

    expect(messages).toEqual([]);
    expect(match.leftTeam.points).toBe(14);
    expect(match.rightTeam.points).toBe(-3);
  });

  test('two power tiers and two neg values', () => {
    const { tournament, format } = tournamentAndFormat((rules) => {
      rules.answerTypes = [
        new AnswerType(20),
        new AnswerType(15),
        new AnswerType(10),
        new AnswerType(-5),
        new AnswerType(-10),
      ];
    });
    const events = padToRegulation(
      [
        buzz(1, 'left', `${leftTeamName} Player 1`, typeIndex(format, 20)),
        bonus(1, 'left', 30),
        buzz(2, 'right', `${rightTeamName} Player 1`, typeIndex(format, -10)),
        buzz(2, 'left', `${leftTeamName} Player 2`, typeIndex(format, 15)),
        bonus(2, 'left', 10),
      ],
      20,
      3,
    );

    const { match, messages } = roundTrip(tournament, format, events);

    expect(messages).toEqual([]);
    expect(match.leftTeam.points).toBe(75);
    expect(match.rightTeam.points).toBe(-10);

    const opener = match.leftTeam.matchPlayers.find((mp) => mp.player.name === `${leftTeamName} Player 1`)!;
    expect(opener.answerCounts.find((ac) => ac.answerType.value === 20)?.number).toBe(1);
  });

  test('a four-part 40-point bonus', () => {
    const { tournament, format } = tournamentAndFormat((rules) => {
      rules.minimumPartsPerBonus = 4;
      rules.maximumPartsPerBonus = 4;
      rules.pointsPerBonusPart = 10;
      rules.maximumBonusScore = 40;
    });
    const events = padToRegulation(
      [buzz(1, 'left', `${leftTeamName} Player 1`, typeIndex(format, 10)), bonus(1, 'left', 40)],
      20,
      2,
    );

    const { match, messages } = roundTrip(tournament, format, events);

    expect(messages).toEqual([]);
    expect(match.leftTeam.points).toBe(50);
    expect(match.leftTeam.getBonusPoints()).toBe(40);
  });

  test('an irregular bonus, which the MODAQ workflow refuses outright', () => {
    const { tournament, format } = tournamentAndFormat((rules) => {
      rules.pointsPerBonusPart = undefined;
      rules.minimumPartsPerBonus = 2;
      rules.maximumPartsPerBonus = 5;
      rules.maximumBonusScore = 50;
      rules.bonusDivisor = 5;
    });
    const events = padToRegulation(
      [buzz(1, 'left', `${leftTeamName} Player 1`, typeIndex(format, 10)), bonus(1, 'left', 25)],
      20,
      2,
    );

    const { match, messages } = roundTrip(tournament, format, events);

    expect(format.bonus.regular).toBe(false);
    expect(messages).toEqual([]);
    expect(match.leftTeam.points).toBe(35);
    expect(match.leftTeam.getBonusPoints()).toBe(25);
  });

  test('lightning rounds, which MODAQ has no concept of', () => {
    const { tournament, format } = tournamentAndFormat((rules) => {
      rules.lightningCountPerTeam = 1;
      rules.lightningDivisor = 5;
    });
    const events = padToRegulation(
      [
        buzz(1, 'left', `${leftTeamName} Player 1`, typeIndex(format, 10)),
        bonus(1, 'left', 20),
        event({ type: 'lightning', questionNumber: 1, team: 'left', points: 60 }),
        event({ type: 'lightning', questionNumber: 1, team: 'right', points: 45 }),
      ],
      20,
      2,
    );

    const { match, messages } = roundTrip(tournament, format, events);

    expect(messages).toEqual([]);
    expect(match.leftTeam.lightningPoints).toBe(60);
    expect(match.rightTeam.lightningPoints).toBe(45);
    expect(match.leftTeam.points).toBe(90);
    expect(match.rightTeam.points).toBe(45);
    // The lightning total must not be mistaken for bonus points.
    expect(match.leftTeam.getBonusPoints()).toBe(20);
  });
});

describe('overtime', () => {
  test('overtime tossups are counted and attributed to the period', () => {
    const { tournament, format } = tournamentAndFormat((rules) => {
      rules.minimumOvertimeQuestionCount = 1;
    });
    const events = padToRegulation([], 20, 1).concat([
      buzz(21, 'left', `${leftTeamName} Player 1`, typeIndex(format, 10)),
    ]);

    const { match, messages } = roundTrip(tournament, format, events);

    expect(messages).toEqual([]);
    expect(match.tossupsRead).toBe(21);
    expect(match.overtimeTossupsRead).toBe(1);
    expect(match.leftTeam.points).toBe(10);
  });

  test('overtime buzzes survive the trip, which a MODAQ export loses', () => {
    // Carried in YfData.overTimeBuzzes, the extension parseMatchTeam reads.
    const { tournament, format } = tournamentAndFormat((rules) => {
      rules.minimumOvertimeQuestionCount = 1;
    });
    const events = padToRegulation([], 20, 1).concat([
      buzz(21, 'left', `${leftTeamName} Player 1`, typeIndex(format, 10)),
    ]);

    const { match } = roundTrip(tournament, format, events);

    expect(match.leftTeam.getCorrectTossupsWithoutBonuses()).toBe(1);
    expect(match.leftTeam.getOvertimePoints()).toBe(10);
    expect(match.rightTeam.getCorrectTossupsWithoutBonuses()).toBe(0);
  });

  test('overtime with bonuses turned on scores the bonus too', () => {
    const { tournament, format } = tournamentAndFormat((rules) => {
      rules.minimumOvertimeQuestionCount = 1;
      rules.overtimeIncludesBonuses = true;
    });
    const events = padToRegulation([], 20, 1).concat([
      buzz(21, 'left', `${leftTeamName} Player 1`, typeIndex(format, 10)),
      bonus(21, 'left', 20),
    ]);

    const { match, messages } = roundTrip(tournament, format, events);

    expect(messages).toEqual([]);
    expect(match.leftTeam.points).toBe(30);
  });
});

describe('substitutions', () => {
  test('substitution and a room-added player preserve exact TUH and answer counts through QBJ import', () => {
    const { tournament, format } = tournamentAndFormat((rules) => {
      rules.maximumPlayersPerTeam = 1;
    });
    const addedName = `${leftTeamName} Taylor Brown`;
    tournament
      .getListOfAllTeams()
      .find((team) => team.name === leftTeamName)!
      .players.push(new Player(addedName));
    const events: ScoreEvent[] = [];
    for (let question = 1; question <= 20; question += 1) {
      if (question === 11) {
        events.push(
          event({
            type: 'substitution',
            questionNumber: 11,
            team: 'left',
            activePlayers: [`${leftTeamName} Player 2`],
          }),
        );
      }
      if (question === 15) {
        events.push(
          event({ type: 'roster-add', questionNumber: 15, team: 'left', playerName: addedName }),
          event({ type: 'substitution', questionNumber: 15, team: 'left', activePlayers: [addedName] }),
        );
      }
      if (question === 12) {
        events.push(buzz(12, 'left', `${leftTeamName} Player 2`, typeIndex(format, 10)), bonus(12, 'left', 20));
      } else events.push(dead(question));
    }

    const { match, messages } = roundTrip(tournament, format, events);
    expect(messages).toEqual([]);
    const byName = new Map(match.leftTeam.matchPlayers.map((matchPlayer) => [matchPlayer.player.name, matchPlayer]));
    expect(byName.get(`${leftTeamName} Player 1`)?.tossupsHeard).toBe(10);
    expect(byName.get(`${leftTeamName} Player 2`)?.tossupsHeard).toBe(4);
    expect(byName.get(addedName)?.tossupsHeard).toBe(6);
    expect(
      byName.get(`${leftTeamName} Player 2`)?.answerCounts.find((count) => count.answerType.value === 10)?.number,
    ).toBe(1);
    expect(match.leftTeam.points).toBe(30);
  });

  test('tossups heard are split between the players who actually played', () => {
    const { tournament, format } = tournamentAndFormat((rules) => {
      rules.maximumPlayersPerTeam = 2;
    });
    const events = padToRegulation(
      [
        // Somebody has to score, or the import quite rightly reports a tie.
        buzz(1, 'left', `${leftTeamName} Player 1`, typeIndex(format, 10)),
        bonus(1, 'left', 20),
        event({
          type: 'substitution',
          questionNumber: 11,
          team: 'left',
          activePlayers: [`${leftTeamName} Player 3`, `${leftTeamName} Player 4`],
        }),
      ],
      20,
      2,
    );

    const { match, messages } = roundTrip(tournament, format, events);

    expect(messages).toEqual([]);
    const heard = (name: string) =>
      match.leftTeam.matchPlayers.find((mp) => mp.player.name === name)?.tossupsHeard ?? 0;
    expect(heard(`${leftTeamName} Player 1`)).toBe(10);
    expect(heard(`${leftTeamName} Player 3`)).toBe(10);
    expect(match.leftTeam.getTotalTossupsHeard()).toBe(40);
  });

  test('a player who never came on is left out of the record', () => {
    const { tournament, format } = tournamentAndFormat((rules) => {
      rules.maximumPlayersPerTeam = 2;
    });

    const { match } = roundTrip(tournament, format, padToRegulation([], 20, 1));

    const names = match.leftTeam.matchPlayers.map((mp) => mp.player.name);
    expect(names).toContain(`${leftTeamName} Player 1`);
    expect(names).not.toContain(`${leftTeamName} Player 3`);
  });
});

describe('forfeits', () => {
  test('a single forfeit imports as a forfeit', () => {
    const { tournament, format } = tournamentAndFormat();

    const { match } = roundTrip(tournament, format, [event({ type: 'forfeit', questionNumber: 1, teams: ['right'] })]);

    expect(match.rightTeam.forfeitLoss).toBe(true);
    expect(match.leftTeam.forfeitLoss).toBe(false);
    expect(match.isForfeit()).toBe(true);
  });

  test('a double forfeit marks both teams', () => {
    const { tournament, format } = tournamentAndFormat();

    const { match } = roundTrip(tournament, format, [
      event({ type: 'forfeit', questionNumber: 1, teams: ['left', 'right'] }),
    ]);

    expect(match.leftTeam.forfeitLoss).toBe(true);
    expect(match.rightTeam.forfeitLoss).toBe(true);
  });
});

describe('notes', () => {
  test('a flagged question reaches the match notes', () => {
    const { tournament, format } = tournamentAndFormat();
    const events = padToRegulation(
      [event({ type: 'note', questionNumber: 12, text: 'possible protest', flagged: true })],
      20,
      1,
    );

    const { match } = roundTrip(tournament, format, events);

    expect(match.notes).toContain('Q12 flagged: possible protest');
  });
});

describe('a game still in progress', () => {
  test('exports a valid partial description rather than a broken one', () => {
    const { tournament, format } = tournamentAndFormat();
    const events = [buzz(1, 'left', `${leftTeamName} Player 1`, typeIndex(format, 15)), bonus(1, 'left', 20), dead(2)];

    const { match } = roundTrip(tournament, format, events);

    expect(match.tossupsRead).toBe(2);
    expect(match.leftTeam.points).toBe(35);
  });
});

describe('the wire format itself', () => {
  test('is snake_case, because camelCase keys get wiped by the importer', () => {
    const { format } = tournamentAndFormat();
    const game = deriveGame(format, setup, [dead(1)]);

    const qbj = toQbjMatch(format, game, { round: 3 });

    expect(qbj).toHaveProperty('tossups_read');
    expect(qbj).toHaveProperty('match_teams');
    expect(qbj).not.toHaveProperty('tossupsRead');
    expect(qbj).not.toHaveProperty('matchTeams');
    expect(qbj._round).toBe(3);
  });

  test('answer types are referenced by value, which is the identity that travels', () => {
    const { format } = tournamentAndFormat();
    const game = deriveGame(format, setup, [buzz(1, 'left', `${leftTeamName} Player 1`, typeIndex(format, 15))]);

    const qbj = toQbjMatch(format, game) as any;
    const counts = qbj.match_teams[0].match_players[0].answer_counts;

    expect(counts).toEqual([{ number: 1, answer_type: { value: 15 } }]);
  });

  test('a forfeit carries no question record', () => {
    const { format } = tournamentAndFormat();
    const game = deriveGame(format, setup, [event({ type: 'forfeit', questionNumber: 1, teams: ['right'] })]);

    const qbj = toQbjMatch(format, game);

    expect(qbj).not.toHaveProperty('tossups_read');
    expect(qbj).not.toHaveProperty('match_questions');
  });

  test('the per-question layer is emitted even though YellowFruit does not read it back', () => {
    // Tournament.useQuestionLevelData is a readonly false, so parseMatch skips match_questions.
    // Emitting it anyway keeps the payload honest and useful to other tools.
    const { format } = tournamentAndFormat();
    const game = deriveGame(format, setup, [
      buzz(1, 'left', `${leftTeamName} Player 1`, typeIndex(format, 15)),
      bonus(1, 'left', 20),
    ]);

    const qbj = toQbjMatch(format, game) as any;

    expect(qbj.match_questions).toHaveLength(1);
    expect(qbj.match_questions[0]).toMatchObject({
      question_number: 1,
      bonus_points: 20,
      buzzes: [{ team: { name: leftTeamName }, result: { value: 15 } }],
    });
  });
});
