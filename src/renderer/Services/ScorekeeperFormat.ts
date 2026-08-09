/**
 * Fruity's adapter from its tournament model to the canonical QBSheet room-safe format.
 *
 * The data descriptor and all validation rules live in QBSheet. This file only knows how to read
 * YellowFruit's ScoringRules object; keeping that adapter here avoids making the shared package
 * depend on Electron or Fruity model classes.
 */
import { scorekeeperFormatVersion, type IScorekeeperFormat } from 'qbsheet';
import { ScoringRules } from '../DataModel/ScoringRules';

export { isScorekeeperFormatUsable, scorekeeperFormatProblems, scorekeeperFormatVersion } from 'qbsheet';
export type {
  IScorekeeperAnswerType,
  IScorekeeperBonus,
  IScorekeeperFormat,
  IScorekeeperLightning,
  IScorekeeperOvertime,
  IScorekeeperPlayers,
  IScorekeeperRegulation,
} from 'qbsheet';

/** Restate Fruity's scoring rules as the plain data QBSheet consumes. */
export default function scoringRulesToScorekeeperFormat(rules: ScoringRules): IScorekeeperFormat {
  return {
    version: scorekeeperFormatVersion,
    name: rules.name,
    answerTypes: rules.answerTypes.map((answerType, index) => ({
      index,
      value: answerType.value,
      label: answerType.label,
      shortLabel: answerType.shortLabel,
      isPower: answerType.isPower,
      isNeg: answerType.isNeg,
      awardsBonus: answerType.value > 0,
      qbjId: answerType.id,
    })),
    regulation: {
      timed: rules.timed,
      tossupCount: rules.regulationTossupCount,
      maximumTossupCount: rules.maximumRegulationTossupCount,
    },
    bonus: {
      enabled: rules.useBonuses,
      bounceBack: rules.useBonuses && rules.bonusesBounceBack,
      regular: rules.bonusesAreRegular(),
      divisor: rules.bonusDivisor,
      minimumParts: rules.minimumPartsPerBonus,
      maximumParts: rules.maximumPartsPerBonus,
      pointsPerPart: rules.pointsPerBonusPart,
      maximumScore: rules.maximumBonusScore,
    },
    overtime: {
      minimumQuestionCount: rules.minimumOvertimeQuestionCount,
      suddenDeath: rules.minimumOvertimeQuestionCount === 1,
      includesBonuses: rules.useBonuses && rules.overtimeIncludesBonuses,
    },
    lightning: {
      enabled: rules.useLightningRounds(),
      countPerTeam: rules.lightningCountPerTeam,
      divisor: rules.lightningDivisor,
    },
    players: {
      maximumActive: rules.maximumPlayersPerTeam,
    },
    totalDivisor: rules.totalDivisor,
  };
}
