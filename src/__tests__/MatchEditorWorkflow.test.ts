import { describe, expect, test } from 'vitest';
import { Match } from '../renderer/DataModel/Match';
import { MatchValidationType } from '../renderer/DataModel/MatchValidationMessage';
import { TempMatchManager } from '../renderer/Modal Managers/TempMatchManager';
import { CommonRuleSets } from '../renderer/DataModel/ScoringRules';
import AnswerType from '../renderer/DataModel/AnswerType';
import { makeTestTournament, testTeamNames } from './TestFixtures';
import { ScheduledMatch } from '../renderer/DataModel/ScheduledMatch';
import { Phase, PhaseTypes } from '../renderer/DataModel/Phase';
import { Pool } from '../renderer/DataModel/Pool';

function openMatchManager(ruleSet: CommonRuleSets = CommonRuleSets.NaqtUntimed) {
  const tournament = makeTestTournament(ruleSet);
  const manager = new TempMatchManager(tournament);
  const round = tournament.phases[0].rounds[0];
  const left = tournament.findTeamByName(testTeamNames[0]);
  const right = tournament.findTeamByName(testTeamNames[1]);
  if (!left || !right) throw new Error('Test teams were not created');
  manager.openModal(undefined, round, left, right);
  return { tournament, manager, round, left, right };
}

function setCounts(manager: TempMatchManager, whichTeam: 'left' | 'right', playerIndex: number, counts: number[]) {
  const player = manager.tempMatch.getMatchTeam(whichTeam).matchPlayers[playerIndex];
  counts.forEach((count, answerIndex) => {
    player.answerCounts[answerIndex].number = count;
  });
}

function enterNaqtUntimedGame(manager: TempMatchManager) {
  manager.setTotalTuh('20');
  for (const whichTeam of ['left', 'right'] as const) {
    manager.tempMatch.getMatchTeam(whichTeam).matchPlayers.forEach((player) => {
      player.tossupsHeard = 20;
    });
  }
  setCounts(manager, 'left', 0, [4, 4, 1]);
  setCounts(manager, 'left', 1, [0, 2, 0]);
  setCounts(manager, 'right', 0, [1, 5, 2]);
  setCounts(manager, 'right', 1, [0, 1, 0]);
  manager.setTeamScore('left', '265');
  manager.setTeamScore('right', '155');
  manager.refreshValidation();
}

describe('Game / Match Editor workflow model', () => {
  test('keeps the traditional untimed rapid-entry defaults and saves a valid NAQT game', () => {
    const { manager } = openMatchManager();

    expect(manager.tempMatch.tossupsRead).toBe(20);
    expect(manager.tempMatch.leftTeam.matchPlayers).toHaveLength(4);
    enterNaqtUntimedGame(manager);

    expect(manager.preSaveValidation()).toBe(true);
    expect(manager.errorDialogIsOpen).toBe(false);
    expect(manager.tempMatch.leftTeam.getBonusStats(manager.tournament.scoringRules)).toEqual(['150', '10', '15.00']);
    expect(manager.tempMatch.rightTeam.getBonusStats(manager.tournament.scoringRules)).toEqual(['90', '7', '12.86']);
  });

  test('supports timed NAQT with a non-default total TUH', () => {
    const { manager } = openMatchManager(CommonRuleSets.NaqtTimed);

    expect(manager.tempMatch.tossupsRead).toBeUndefined();
    manager.setTotalTuh('24');
    for (const whichTeam of ['left', 'right'] as const) {
      manager.tempMatch.getMatchTeam(whichTeam).matchPlayers.forEach((player) => {
        player.tossupsHeard = 24;
      });
    }
    setCounts(manager, 'left', 0, [2, 3, 1]);
    setCounts(manager, 'right', 0, [1, 4, 1]);
    manager.setTeamScore('left', '170');
    manager.setTeamScore('right', '140');
    manager.refreshValidation();

    expect(manager.tempMatch.tossupsRead).toBe(24);
    expect(manager.preSaveValidation()).toBe(true);
  });

  test('keeps custom answer types and special scoring data available', () => {
    const { manager } = openMatchManager();
    manager.tournament.scoringRules.answerTypes.push(new AnswerType(5));
    manager.tournament.scoringRules.bonusesBounceBack = true;
    manager.tournament.scoringRules.lightningCountPerTeam = 1;
    manager.tournament.scoringRules.lightningDivisor = 5;

    manager.openModal(undefined, manager.round, manager.tempMatch.leftTeam.team, manager.tempMatch.rightTeam.team);
    expect(manager.tempMatch.leftTeam.matchPlayers[0].answerCounts).toHaveLength(4);
    expect(manager.tempMatch.leftTeam.overTimeBuzzes).toHaveLength(4);
    manager.setBouncebackPoints('left', '20');
    manager.setLightningPoints('right', '15');
    manager.setOtTuhRead('3');

    expect(manager.tempMatch.leftTeam.bonusBouncebackPoints).toBe(20);
    expect(manager.tempMatch.rightTeam.lightningPoints).toBe(15);
    expect(manager.tempMatch.overtimeTossupsRead).toBe(3);
  });

  test('keeps inline validation authoritative and supports warning suppression/restoration', () => {
    const { manager } = openMatchManager();
    manager.setTotalTuh('19');
    manager.refreshValidation();

    expect(manager.tempMatch.getWarningMessages().some((message) => /less than 20/.test(message))).toBe(true);
    expect(manager.preSaveValidation()).toBe(false);
    expect(manager.errorDialogIsOpen).toBe(false);

    manager.suppressValidationMessage(MatchValidationType.LowTotalTuh);
    expect(manager.tempMatch.getNumSuppressedWarnings()).toBeGreaterThan(0);
    manager.restoreSuppressedMsgs();
    expect(manager.tempMatch.getNumSuppressedWarnings()).toBe(0);
  });

  test('preserves duplicate-team validation, reorder, and keyboard-equivalent row movement', () => {
    const { manager } = openMatchManager();
    const { leftTeam } = manager.tempMatch;
    const firstPlayer = leftTeam.matchPlayers[0].player.name;
    const secondPlayer = leftTeam.matchPlayers[1].player.name;

    manager.moveMatchPlayer('left', 1, 'up');
    expect(leftTeam.matchPlayers[0].player.name).toBe(secondPlayer);
    expect(leftTeam.matchPlayers[1].player.name).toBe(firstPlayer);

    manager.teamSelectChangeTeam('right', testTeamNames[0]);
    manager.refreshValidation();
    expect(manager.tempMatch.getErrorMessages()).toContain('A team cannot play itself');
  });

  test('Save & New keeps the round and clears the prior game without room requirements', () => {
    const { tournament, manager, round, left, right } = openMatchManager();
    const originalId = manager.tempMatch.id;
    enterNaqtUntimedGame(manager);
    expect(manager.preSaveValidation()).toBe(true);
    manager.saveNewMatch();
    manager.resetForNewMatch();

    expect(manager.modalIsOpen).toBe(true);
    expect(manager.round).toBe(round);
    expect(manager.roundNumber).toBe(round.number);
    expect(manager.originalMatchLoaded).toBeUndefined();
    expect(manager.tempMatch.id).not.toBe(originalId);
    expect(manager.tempMatch.leftTeam.team).toBeUndefined();
    expect(tournament.phases[0].rounds[0].matches).toHaveLength(1);
    expect(left.name).toBe(testTeamNames[0]);
    expect(right.name).toBe(testTeamNames[1]);
  });

  test('shows scheduled room context only for an accepted linked result', () => {
    const { tournament, manager, round, left, right } = openMatchManager();
    const match = new Match(left, right, tournament.scoringRules.answerTypes);
    round.addMatch(match);
    const scheduled = new ScheduledMatch(round.number, left.name, right.name, 'scheduled-1');
    scheduled.resultMatchId = match.id;
    scheduled.roomNameAtPlay = 'Room 104';
    tournament.scheduledMatches = [scheduled];

    manager.openModal(match, round);
    expect(manager.scheduledMatchContext?.roomNameAtPlay).toBe('Room 104');
    manager.openModal(undefined, round);
    expect(manager.scheduledMatchContext).toBeUndefined();
  });

  test('supports nonnumeric rounds, derived stage, and carryover selection', () => {
    const { tournament, manager, round } = openMatchManager();
    const playoffPhase = new Phase(PhaseTypes.Playoff, 4, 4, '2', 'Playoffs');
    tournament.phases.push(playoffPhase);

    expect(manager.phase?.name).toBe('Round Robin');
    expect(manager.getAvailableCarryOverPhases()).toContain(playoffPhase);
    manager.setCarryoverPhases([playoffPhase.name]);
    expect(manager.tempMatch.carryoverPhases).toEqual([playoffPhase]);

    manager.setRoundNo('99');
    expect(manager.round).toBeUndefined();
    expect(manager.roundFieldError).toBe('This round number is not a part of any Stage');
    manager.setRoundNo('');
    expect(manager.roundFieldError).toBe('Round number is required');

    const tiebreakerPhase = new Phase(PhaseTypes.Tiebreaker, 3.5, 3.5, '1T', 'Tiebreakers');
    tournament.phases.push(tiebreakerPhase);
    const tiebreakerRound = tiebreakerPhase.rounds[0];
    manager.openModal(undefined, tiebreakerRound);
    expect(manager.round).toBe(tiebreakerRound);
    expect(manager.roundNumber).toBeUndefined();
    expect(manager.phase?.phaseType).toBe(PhaseTypes.Tiebreaker);
    expect(manager.roundFieldError).toBeUndefined();
    expect(round.number).toBe(1);
  });

  test('keeps pool, already-played, and score/stat validation actionable', () => {
    const { tournament, manager, round, left, right } = openMatchManager();
    const existing = new Match(left, right, tournament.scoringRules.answerTypes);
    round.addMatch(existing);

    manager.validateHaveTeamsPlayedInRound(true);
    expect(manager.tempMatch.getWarningMessages()).toContain('Both teams have already played a game in this round');

    const phase = tournament.phases[0];
    const pool = phase.pools[0];
    pool.clearTeams();
    pool.addTeam(left);
    pool.addTeam(right);
    const otherPool = new Pool(2, 2, 'Other Pool');
    otherPool.addTeam(tournament.findTeamByName(testTeamNames[2])!);
    otherPool.addTeam(tournament.findTeamByName(testTeamNames[3])!);
    phase.pools.push(otherPool);

    manager.teamSelectChangeTeam('right', testTeamNames[2]);
    manager.validateTeamPools(true);
    expect(manager.tempMatch.getWarningMessages()).toContain('These teams are not in the same pool for this round');

    manager.tournament.scoringRules.setUseBonuses(false);
    manager.refreshValidation();
    manager.setTeamScore('left', '10');
    expect(manager.tempMatch.getErrorMessages()).toEqual(
      expect.arrayContaining([expect.stringContaining("Players' points don't add up to total score")]),
    );
    expect(manager.preSaveValidation()).toBe(false);
    expect(manager.errorDialogIsOpen).toBe(false);
  });

  test('cleans irrelevant match data when a team forfeits', () => {
    const { manager } = openMatchManager();
    manager.setForfeit('left', true);
    manager.setNotes('Administrative forfeit');

    expect(manager.preSaveValidation()).toBe(true);
    expect(manager.tempMatch.leftTeam.matchPlayers).toHaveLength(0);
    expect(manager.tempMatch.rightTeam.matchPlayers).toHaveLength(0);
    expect(manager.tempMatch.tossupsRead).toBeUndefined();
    expect(manager.tempMatch.notes).toBe('Administrative forfeit');
  });

  test('keeps manual entry independent of rooms while requiring a valid round before save', () => {
    const tournament = makeTestTournament(CommonRuleSets.NaqtUntimed);
    const manager = new TempMatchManager(tournament);
    manager.openModal();

    expect(manager.preSaveValidation()).toBe(false);
    expect(manager.roundFieldError).toBe('Round number is required');
    expect(manager.errorDialogIsOpen).toBe(false);
  });
});
