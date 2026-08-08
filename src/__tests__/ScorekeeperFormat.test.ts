import { describe, expect, test } from 'vitest';
import scoringRulesToScorekeeperFormat, {
  isScorekeeperFormatUsable,
  scorekeeperFormatProblems,
  scorekeeperFormatVersion,
} from '../renderer/Services/ScorekeeperFormat';
import { CommonRuleSets, ScoringRules } from '../renderer/DataModel/ScoringRules';
import AnswerType from '../renderer/DataModel/AnswerType';

/** A rule set with the presets' common settings, ready to be pushed somewhere unusual. */
function customRules(): ScoringRules {
  return new ScoringRules(CommonRuleSets.Acf);
}

describe('preset rule sets', () => {
  test('ACF: two answer types, no powers, bonuses without bouncebacks', () => {
    const format = scoringRulesToScorekeeperFormat(new ScoringRules(CommonRuleSets.Acf));

    expect(format.answerTypes.map((at) => at.value)).toEqual([10, -5]);
    expect(format.answerTypes.some((at) => at.isPower)).toBe(false);
    expect(format.regulation.timed).toBe(false);
    expect(format.regulation.tossupCount).toBe(20);
    expect(format.bonus.enabled).toBe(true);
    expect(format.bonus.bounceBack).toBe(false);
    expect(format.bonus.regular).toBe(true);
    expect(format.lightning.enabled).toBe(false);
  });

  test('mACF with powers: the 15 is a power and the -5 is a neg', () => {
    const format = scoringRulesToScorekeeperFormat(new ScoringRules(CommonRuleSets.AcfPowers));

    expect(format.answerTypes.map((at) => [at.value, at.isPower, at.isNeg])).toEqual([
      [15, true, false],
      [10, false, false],
      [-5, false, true],
    ]);
  });

  test('NAQT untimed: overtime runs three tossups, so it is not sudden death', () => {
    const format = scoringRulesToScorekeeperFormat(new ScoringRules(CommonRuleSets.NaqtUntimed));

    expect(format.overtime.minimumQuestionCount).toBe(3);
    expect(format.overtime.suddenDeath).toBe(false);
    expect(format.overtime.includesBonuses).toBe(false);
  });

  test('NAQT timed: the round is marked timed', () => {
    const format = scoringRulesToScorekeeperFormat(new ScoringRules(CommonRuleSets.NaqtTimed));

    expect(format.regulation.timed).toBe(true);
    expect(format.regulation.maximumTossupCount).toBe(24);
  });

  test('a timed format reports 20 regulation tossups regardless of its maximum', () => {
    // Not a quirk of this descriptor: ScoringRules.regulationTossupCount hardcodes the default for
    // timed rounds. Pinned here so a change upstream is noticed rather than silently inherited.
    const format = scoringRulesToScorekeeperFormat(new ScoringRules(CommonRuleSets.NaqtTimed));

    expect(format.regulation.maximumTossupCount).toBe(24);
    expect(format.regulation.tossupCount).toBe(20);
  });
});

describe('answer types', () => {
  test('an arbitrary custom set is carried through in order', () => {
    const rules = customRules();
    rules.answerTypes = [new AnswerType(25), new AnswerType(20), new AnswerType(10), new AnswerType(-10)];

    const format = scoringRulesToScorekeeperFormat(rules);

    expect(format.answerTypes.map((at) => at.value)).toEqual([25, 20, 10, -10]);
    expect(format.answerTypes.map((at) => at.index)).toEqual([0, 1, 2, 3]);
  });

  test('multiple power tiers are each marked as powers', () => {
    const rules = customRules();
    rules.answerTypes = [new AnswerType(20), new AnswerType(15), new AnswerType(10), new AnswerType(-5)];

    const format = scoringRulesToScorekeeperFormat(rules);

    expect(format.answerTypes.filter((at) => at.isPower).map((at) => at.value)).toEqual([20, 15]);
  });

  test('multiple negative values are each marked as negs', () => {
    // MODAQ has a single negValue and refuses this outright.
    const rules = customRules();
    rules.answerTypes = [new AnswerType(10), new AnswerType(-5), new AnswerType(-10)];

    const format = scoringRulesToScorekeeperFormat(rules);

    expect(format.answerTypes.filter((at) => at.isNeg).map((at) => at.value)).toEqual([-5, -10]);
  });

  test('a format with no negs simply has none', () => {
    const rules = customRules();
    rules.answerTypes = [new AnswerType(10)];

    const format = scoringRulesToScorekeeperFormat(rules);

    expect(format.answerTypes.some((at) => at.isNeg)).toBe(false);
  });

  test('a base tossup value other than 10 is carried through', () => {
    // The single most common reason the MODAQ adapter refuses a tournament.
    const rules = customRules();
    rules.answerTypes = [new AnswerType(7), new AnswerType(-3)];

    const format = scoringRulesToScorekeeperFormat(rules);

    expect(format.answerTypes.map((at) => at.value)).toEqual([7, -3]);
    expect(format.answerTypes[0].isPower).toBe(false);
  });

  test('a base value above 10 is reported as a power, matching YellowFruit', () => {
    // AnswerType.isPower is exactly `value > 10`, with nothing stored behind it, so a 12-point base
    // tossup is a "power" everywhere in YellowFruit. Recorded so the behaviour is a known one.
    const rules = customRules();
    rules.answerTypes = [new AnswerType(12), new AnswerType(-5)];

    const format = scoringRulesToScorekeeperFormat(rules);

    expect(format.answerTypes[0].isPower).toBe(true);
  });

  test('labels default to the point value and are overridable', () => {
    const rules = customRules();
    const power = new AnswerType(15);
    power.label = 'Power';
    power.shortLabel = 'P';
    rules.answerTypes = [power, new AnswerType(10)];

    const format = scoringRulesToScorekeeperFormat(rules);

    expect(format.answerTypes[0].label).toBe('Power');
    expect(format.answerTypes[0].shortLabel).toBe('P');
    expect(format.answerTypes[1].label).toBe('10');
    expect(format.answerTypes[1].shortLabel).toBe('10');
  });

  test('only positive answer types award a bonus', () => {
    const rules = customRules();
    rules.answerTypes = [new AnswerType(15), new AnswerType(10), new AnswerType(0), new AnswerType(-5)];

    const format = scoringRulesToScorekeeperFormat(rules);

    expect(format.answerTypes.map((at) => at.awardsBonus)).toEqual([true, true, false, false]);
  });
});

describe('bonuses', () => {
  test('bonuses off reports no bonus and no bounceback', () => {
    const rules = customRules();
    rules.setUseBonuses(false);

    const format = scoringRulesToScorekeeperFormat(rules);

    expect(format.bonus.enabled).toBe(false);
    expect(format.bonus.bounceBack).toBe(false);
  });

  test('bouncebacks are reported when enabled', () => {
    const rules = customRules();
    rules.bonusesBounceBack = true;

    expect(scoringRulesToScorekeeperFormat(rules).bonus.bounceBack).toBe(true);
  });

  test('a bounceback flag left set while bonuses are off does not leak through', () => {
    const rules = customRules();
    rules.bonusesBounceBack = true;
    rules.useBonuses = false; // assigned directly, bypassing setUseBonuses

    expect(scoringRulesToScorekeeperFormat(rules).bonus.bounceBack).toBe(false);
  });

  test('a non-30-point bonus is carried through', () => {
    const rules = customRules();
    rules.pointsPerBonusPart = 5;
    rules.maximumPartsPerBonus = 3;
    rules.minimumPartsPerBonus = 3;
    rules.maximumBonusScore = 15;
    rules.bonusDivisor = 5;

    const format = scoringRulesToScorekeeperFormat(rules);

    expect(format.bonus.regular).toBe(true);
    expect(format.bonus.maximumScore).toBe(15);
    expect(format.bonus.pointsPerPart).toBe(5);
    expect(format.bonus.divisor).toBe(5);
  });

  test('a bonus with a different part count is carried through', () => {
    const rules = customRules();
    rules.minimumPartsPerBonus = 4;
    rules.maximumPartsPerBonus = 4;
    rules.pointsPerBonusPart = 10;
    rules.maximumBonusScore = 40;

    const format = scoringRulesToScorekeeperFormat(rules);

    expect(format.bonus.regular).toBe(true);
    expect(format.bonus.minimumParts).toBe(4);
    expect(format.bonus.maximumParts).toBe(4);
    expect(format.bonus.maximumScore).toBe(40);
  });

  test('a varying part count makes the bonus irregular', () => {
    const rules = customRules();
    rules.minimumPartsPerBonus = 2;
    rules.maximumPartsPerBonus = 4;

    expect(scoringRulesToScorekeeperFormat(rules).bonus.regular).toBe(false);
  });

  test('parts not all worth the same makes the bonus irregular', () => {
    // Clearing "Pts per bonus part" in the rules UI is what produces this.
    const rules = customRules();
    rules.pointsPerBonusPart = undefined;

    const format = scoringRulesToScorekeeperFormat(rules);

    expect(format.bonus.regular).toBe(false);
    expect(format.bonus.pointsPerPart).toBeUndefined();
    // Still enough to validate a total against.
    expect(format.bonus.maximumScore).toBe(30);
    expect(format.bonus.divisor).toBe(10);
  });
});

describe('overtime', () => {
  test('a one-question overtime period is sudden death', () => {
    const rules = customRules();
    rules.minimumOvertimeQuestionCount = 1;

    expect(scoringRulesToScorekeeperFormat(rules).overtime.suddenDeath).toBe(true);
  });

  test('overtime with bonuses is reported', () => {
    const rules = customRules();
    rules.overtimeIncludesBonuses = true;

    expect(scoringRulesToScorekeeperFormat(rules).overtime.includesBonuses).toBe(true);
  });

  test('overtime cannot include bonuses when the format has none', () => {
    const rules = customRules();
    rules.overtimeIncludesBonuses = true;
    rules.useBonuses = false; // assigned directly, bypassing setUseBonuses

    expect(scoringRulesToScorekeeperFormat(rules).overtime.includesBonuses).toBe(false);
  });
});

describe('lightning rounds', () => {
  test('off by default', () => {
    const format = scoringRulesToScorekeeperFormat(customRules());

    expect(format.lightning.enabled).toBe(false);
    expect(format.lightning.countPerTeam).toBe(0);
  });

  test('enabled with its divisor when a count is set', () => {
    // MODAQ has no concept of these at all and refuses the tournament outright.
    const rules = customRules();
    rules.lightningCountPerTeam = 2;
    rules.lightningDivisor = 5;

    const format = scoringRulesToScorekeeperFormat(rules);

    expect(format.lightning.enabled).toBe(true);
    expect(format.lightning.countPerTeam).toBe(2);
    expect(format.lightning.divisor).toBe(5);
  });
});

describe('players', () => {
  test('the configured maximum active player count is carried through', () => {
    const rules = customRules();
    rules.maximumPlayersPerTeam = 6;

    expect(scoringRulesToScorekeeperFormat(rules).players.maximumActive).toBe(6);
  });
});

describe('total divisor', () => {
  test('standard values divide by 5, because of the -5', () => {
    expect(scoringRulesToScorekeeperFormat(new ScoringRules(CommonRuleSets.AcfPowers)).totalDivisor).toBe(5);
  });

  test('a value not divisible by 5 drops the divisor to 1', () => {
    const rules = customRules();
    rules.answerTypes = [new AnswerType(7), new AnswerType(-3)];

    expect(scoringRulesToScorekeeperFormat(rules).totalDivisor).toBe(1);
  });
});

describe('a custom format combining everything at once', () => {
  test('arbitrary answer types, irregular bonuses, bouncebacks, lightning and overtime coexist', () => {
    const rules = customRules();
    rules.name = 'House rules';
    rules.answerTypes = [
      new AnswerType(25),
      new AnswerType(20),
      new AnswerType(10),
      new AnswerType(-5),
      new AnswerType(-10),
    ];
    rules.minimumPartsPerBonus = 2;
    rules.maximumPartsPerBonus = 5;
    rules.pointsPerBonusPart = undefined;
    rules.maximumBonusScore = 50;
    rules.bonusDivisor = 5;
    rules.bonusesBounceBack = true;
    rules.lightningCountPerTeam = 1;
    rules.lightningDivisor = 5;
    rules.minimumOvertimeQuestionCount = 1;
    rules.overtimeIncludesBonuses = true;
    rules.maximumPlayersPerTeam = 5;

    const format = scoringRulesToScorekeeperFormat(rules);

    expect(format.answerTypes).toHaveLength(5);
    expect(format.bonus.regular).toBe(false);
    expect(format.bonus.bounceBack).toBe(true);
    expect(format.lightning.enabled).toBe(true);
    expect(format.overtime.suddenDeath).toBe(true);
    expect(format.overtime.includesBonuses).toBe(true);
    expect(format.players.maximumActive).toBe(5);
    expect(scorekeeperFormatProblems(format)).toEqual([]);
  });
});

describe('serialization', () => {
  test('survives a JSON round trip unchanged', () => {
    // It is cached in localStorage and sent over HTTP, so this is the property that matters most.
    const rules = new ScoringRules(CommonRuleSets.AcfPowers);
    rules.lightningCountPerTeam = 2;
    const format = scoringRulesToScorekeeperFormat(rules);

    expect(JSON.parse(JSON.stringify(format))).toEqual(format);
  });

  test('an irregular bonus survives the round trip still irregular', () => {
    // pointsPerPart is undefined here, and JSON drops undefined properties entirely.
    const rules = customRules();
    rules.pointsPerBonusPart = undefined;
    const format = scoringRulesToScorekeeperFormat(rules);

    const revived = JSON.parse(JSON.stringify(format));

    expect(revived.bonus.regular).toBe(false);
    expect(revived.bonus.pointsPerPart).toBeUndefined();
  });
});

describe('scoreability', () => {
  test('every preset is scoreable', () => {
    for (const ruleSet of Object.values(CommonRuleSets)) {
      const format = scoringRulesToScorekeeperFormat(new ScoringRules(ruleSet));

      expect(scorekeeperFormatProblems(format), `${ruleSet} should be scoreable`).toEqual([]);
      expect(isScorekeeperFormatUsable(format)).toBe(true);
    }
  });

  test('no answer types at all is refused', () => {
    const rules = customRules();
    rules.answerTypes = [];

    const problems = scorekeeperFormatProblems(scoringRulesToScorekeeperFormat(rules));

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('no answer types');
  });

  test('a format that can only lose points is refused', () => {
    const rules = customRules();
    rules.answerTypes = [new AnswerType(-5)];

    const problems = scorekeeperFormatProblems(scoringRulesToScorekeeperFormat(rules));

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('no way to score points');
  });

  test('a null format is not usable', () => {
    expect(isScorekeeperFormatUsable(null)).toBe(false);
  });

  test('an unrecognized version is refused without trusting anything else', () => {
    const format = scoringRulesToScorekeeperFormat(customRules());
    const stale = { ...format, version: scorekeeperFormatVersion + 1, answerTypes: [] };

    const problems = scorekeeperFormatProblems(stale);

    // Only the version complaint: the empty answerTypes is not reported, because a descriptor whose
    // shape we don't recognize can't be inspected field by field.
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('different version');
  });
});
