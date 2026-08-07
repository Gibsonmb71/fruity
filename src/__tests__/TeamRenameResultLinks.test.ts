/**
 * Renaming a team must not break the link to an official result.
 *
 * `Match.id` is `Match_<number>~<left team abbreviation><right team abbreviation>`, so it is partly
 * computed from data a director can edit at any point in the day. An accepted `ScheduledMatch`
 * stores that whole id in `resultMatchId`, and that link is what the correction workflow, the
 * deletion guard, and the schedule's claim to have produced a result all resolve through. Renaming a
 * team therefore moves the target of a durable reference — quietly, and after the fact.
 *
 * These tests drive the real team form through `TournamentManager`, because the reconciliation has
 * to happen inside the same commit as the rename. Checking the service functions alone would not
 * catch a manager that forgets to call them, which is precisely the bug.
 */
import { describe, expect, test } from 'vitest';
import FileParser from '../renderer/DataModel/FileParsing';
import Tournament, { IYftFileTournament } from '../renderer/DataModel/Tournament';
import { Match } from '../renderer/DataModel/Match';
import { Round } from '../renderer/DataModel/Round';
import { ScheduledMatch, ScheduledMatchStatus } from '../renderer/DataModel/ScheduledMatch';
import { TempMatchManager } from '../renderer/Modal Managers/TempMatchManager';
import { TournamentManager } from '../renderer/TournamentManager';
import { makeTestTournament, testTeamNames } from './TestFixtures';

class TestTournamentManager extends TournamentManager {
  toasts: { message: string; severity?: string }[] = [];

  // eslint-disable-next-line class-methods-use-this
  addIpcListeners(): void {}

  // eslint-disable-next-line class-methods-use-this
  protected setWindowTitle(): void {}

  // eslint-disable-next-line class-methods-use-this
  requestAppVersion(): void {}

  // eslint-disable-next-line class-methods-use-this
  requestBackupFile(): void {}

  // eslint-disable-next-line class-methods-use-this
  checkForNewVersion(): void {}

  // eslint-disable-next-line class-methods-use-this
  setFilePath(): void {}
}

function newManager(tournament: Tournament): TestTournamentManager {
  const manager = new TestTournamentManager();
  manager.tournament = tournament;
  manager.toasts = [];
  manager.makeToast = (message: string, severity?: string) => {
    manager.toasts.push({ message, severity });
  };
  return manager;
}

/** Play a game between two named teams in the given round, the way manual entry would. */
function playGame(tournament: Tournament, round: Round, leftName: string, rightName: string): Match {
  const left = tournament.findTeamByName(leftName);
  const right = tournament.findTeamByName(rightName);
  if (!left || !right) throw new Error(`missing test team: ${leftName} / ${rightName}`);
  const match = new Match(left, right, tournament.scoringRules.answerTypes);
  round.addMatch(match);
  return match;
}

/** Link a played game to an accepted scheduled match, the way accepting a room submission does. */
function accept(tournament: Tournament, round: Round, match: Match): ScheduledMatch {
  const scheduled = new ScheduledMatch(round.number, match.leftTeam.team?.name ?? '', match.rightTeam.team?.name ?? '');
  scheduled.phaseCode = tournament.whichPhaseIsRoundNumberIn(round.number)?.code ?? '';
  scheduled.status = ScheduledMatchStatus.Accepted;
  scheduled.resultMatchId = match.id;
  tournament.scheduledMatches.push(scheduled);
  return scheduled;
}

/**
 * Rename a team through the actual edit form.
 *
 * The form edits the organization name rather than the team name directly, which is why this goes
 * through the modal manager instead of assigning to `team.name`: the commit path being tested is the
 * one a director uses.
 */
function renameTeam(manager: TestTournamentManager, currentName: string, nextName: string) {
  const { tournament } = manager;
  const registration = tournament.registrations.find((reg) => reg.teams.some((team) => team.name === currentName));
  const team = registration?.teams.find((candidate) => candidate.name === currentName);
  if (!registration || !team) throw new Error(`no registered team named ${currentName}`);

  manager.openTeamEditModalExistingTeam(registration, team);
  manager.teamModalManager.changeTeamName(nextName);
  manager.teamEditModalAttemptToSave();
}

/**
 * Rename, and insist the rename actually landed.
 *
 * Everything downstream of a rename — the deletion guard, the correction workflow, the saved file —
 * would pass vacuously against a tournament whose rename was refused and rolled back. This makes
 * that impossible to mistake for success.
 */
function renameTeamAndCommit(manager: TestTournamentManager, currentName: string, nextName: string) {
  renameTeam(manager, currentName, nextName);
  expect(manager.toasts).toHaveLength(0);
  expect(manager.tournament.findTeamByName(nextName)).toBeDefined();
  expect(manager.tournament.findTeamByName(currentName)).toBeUndefined();
}

/** How many official games in the whole tournament answer to this id */
function matchesWithId(tournament: Tournament, matchId: string | undefined): Match[] {
  return tournament.phases.flatMap((phase) => phase.getAllMatches()).filter((match) => match.id === matchId);
}

/** Save to a .yft-shaped object and read it back, as saving and reopening the file would */
function saveAndReopen(tournament: Tournament): Tournament {
  tournament.appVersion = '4.0.18';
  const written = JSON.parse(JSON.stringify(tournament.toFileObject())) as IYftFileTournament;
  const reopened = new FileParser({}).parseYftTournament(written, '4.0.18');
  if (reopened === null) throw new Error('the tournament file failed to parse');
  return reopened;
}

/** One accepted official result in round 1, between the first two test teams. */
function withOneAcceptedResult() {
  const tournament = makeTestTournament();
  const manager = newManager(tournament);
  const round = tournament.phases[0].rounds[0];
  const match = playGame(tournament, round, testTeamNames[0], testTeamNames[1]);
  const scheduled = accept(tournament, round, match);
  return { tournament, manager, round, match, scheduled };
}

describe('the rename actually moves the official game id', () => {
  test('renaming a team changes the computed id of a game it played', () => {
    // Not an assertion about desired behaviour — it is the premise everything below exists for. If
    // this ever stops being true, the reconciliation is no longer load-bearing.
    const { manager, match } = withOneAcceptedResult();
    const before = match.id;

    renameTeam(manager, testTeamNames[0], 'Ninety Six Central A');

    expect(match.id).not.toBe(before);
  });
});

describe('an accepted result survives renaming a team that played in it', () => {
  test('the schedule points at the id the game has now', () => {
    const { tournament, manager, match, scheduled } = withOneAcceptedResult();
    const oldId = scheduled.resultMatchId;

    renameTeam(manager, testTeamNames[0], 'Ninety Six Central A');

    expect(scheduled.resultMatchId).not.toBe(oldId);
    expect(scheduled.resultMatchId).toBe(match.id);
    expect(matchesWithId(tournament, scheduled.resultMatchId)).toHaveLength(1);
  });

  test('the result stays accepted, and stays the same game', () => {
    const { manager, match, scheduled } = withOneAcceptedResult();

    renameTeam(manager, testTeamNames[0], 'Ninety Six Central A');

    expect(scheduled.status).toBe(ScheduledMatchStatus.Accepted);
    expect(matchesWithId(manager.tournament, scheduled.resultMatchId)[0]).toBe(match);
  });

  test('the schedule names the team by its new name too', () => {
    const { manager, scheduled } = withOneAcceptedResult();

    renameTeam(manager, testTeamNames[0], 'Ninety Six Central A');

    expect(scheduled.leftTeamName).toBe('Ninety Six Central A');
    expect(scheduled.matchesTeams('Ninety Six Central A', testTeamNames[1])).toBe(true);
  });

  test('the rename is not refused', () => {
    const { manager } = withOneAcceptedResult();

    renameTeam(manager, testTeamNames[0], 'Ninety Six Central A');

    expect(manager.toasts).toHaveLength(0);
    expect(manager.tournament.findTeamByName('Ninety Six Central A')).toBeDefined();
  });
});

describe('every official game the renamed team played is relinked', () => {
  /** Three accepted results in three rounds, two with the renamed team on the left and one on the right. */
  function withThreeAcceptedResults() {
    const tournament = makeTestTournament();
    const manager = newManager(tournament);
    const [a, b, c, d] = testTeamNames;
    const { rounds } = tournament.phases[0];

    const games = [
      { round: rounds[0], left: a, right: b },
      { round: rounds[1], left: a, right: c },
      { round: rounds[2], left: d, right: a },
    ].map(({ round, left, right }) => {
      const match = playGame(tournament, round, left, right);
      return { match, scheduled: accept(tournament, round, match), oldId: match.id };
    });

    // One game with no involvement from the team being renamed, as a control.
    const unrelated = playGame(tournament, rounds[0], c, d);
    const unrelatedScheduled = accept(tournament, rounds[0], unrelated);

    return { tournament, manager, games, unrelated, unrelatedScheduled };
  }

  test('all three links move to the ids their games now have', () => {
    const { tournament, manager, games } = withThreeAcceptedResults();

    renameTeam(manager, testTeamNames[0], 'Ninety Six Central A');

    for (const game of games) {
      expect(game.scheduled.resultMatchId).not.toBe(game.oldId);
      expect(game.scheduled.resultMatchId).toBe(game.match.id);
      expect(matchesWithId(tournament, game.scheduled.resultMatchId)).toHaveLength(1);
      expect(game.scheduled.status).toBe(ScheduledMatchStatus.Accepted);
    }
  });

  test('how the game got into the tournament makes no difference', () => {
    // A renamed team's official history can be a mixture: entered by hand, imported from a QBJ file,
    // accepted from a room, and carried into a later stage. All of them are `Match` objects whose id
    // moves the same way, so all of them are captured the same way.
    const { tournament, manager, games } = withThreeAcceptedResults();
    games[0].match.importedFile = 'round-1.qbj';
    games[1].match.addCarryoverPhase(tournament.phases[tournament.phases.length - 1]);

    renameTeamAndCommit(manager, testTeamNames[0], 'Ninety Six Central A');

    expect(games[0].scheduled.resultMatchId).toBe(games[0].match.id);
    expect(games[0].match.importedFile).toBe('round-1.qbj');
    expect(games[1].scheduled.resultMatchId).toBe(games[1].match.id);
    expect(games[1].match.carryoverPhases).toHaveLength(1);
    // Carryover puts one game in two stages' statistics; it must still be one game with one id.
    expect(matchesWithId(tournament, games[1].scheduled.resultMatchId)).toHaveLength(1);
  });

  test('a game the renamed team had nothing to do with is left exactly as it was', () => {
    const { manager, unrelated, unrelatedScheduled } = withThreeAcceptedResults();
    const untouchedId = unrelated.id;

    renameTeamAndCommit(manager, testTeamNames[0], 'Ninety Six Central A');

    expect(unrelated.id).toBe(untouchedId);
    expect(unrelatedScheduled.resultMatchId).toBe(untouchedId);
    expect(unrelatedScheduled.leftTeamName).toBe(testTeamNames[2]);
    expect(unrelatedScheduled.rightTeamName).toBe(testTeamNames[3]);
  });
});

describe('the workflows that resolve through the link still work afterwards', () => {
  test('the official result is still recognized, so ordinary delete stays blocked', () => {
    const { manager, round, match } = withOneAcceptedResult();

    renameTeamAndCommit(manager, testTeamNames[0], 'Ninety Six Central A');
    manager.toasts = [];

    expect(manager.deleteMatch(match, round)).toBe(false);
    expect(round.matches).toContain(match);
    expect(manager.toasts[0]?.message).toContain('Correct official result');
  });

  test('correcting the official result still opens and saves the right game', () => {
    const { tournament, manager, round, match, scheduled } = withOneAcceptedResult();

    renameTeamAndCommit(manager, testTeamNames[0], 'Ninety Six Central A');

    // The correction workflow finds the game from the accepted link, not from team names.
    const found = matchesWithId(tournament, scheduled.resultMatchId);
    expect(found).toEqual([match]);

    const editor = new TempMatchManager(tournament);
    editor.openModal(match, round);
    editor.setNotes('Corrected from the signed scoresheet.');

    expect(editor.saveExistingMatch(match)).toBe(true);
    expect(match.notes).toBe('Corrected from the signed scoresheet.');
    expect(scheduled.resultMatchId).toBe(match.id);
    expect(scheduled.status).toBe(ScheduledMatchStatus.Accepted);
  });

  test('the tournament still finds the accepted schedule entry from the game', () => {
    const { tournament, manager, match, scheduled } = withOneAcceptedResult();

    renameTeamAndCommit(manager, testTeamNames[0], 'Ninety Six Central A');

    expect(tournament.acceptedScheduledMatchForResult(match.id)).toBe(scheduled);
  });
});

describe('the reconciled link survives a save and reopen', () => {
  test('the reopened file still resolves the accepted result to exactly one game', () => {
    const { tournament, manager, scheduled } = withOneAcceptedResult();

    renameTeamAndCommit(manager, testTeamNames[0], 'Ninety Six Central A');
    const reconciledId = scheduled.resultMatchId;

    const reopened = saveAndReopen(tournament);

    expect(reopened.scheduledMatches).toHaveLength(1);
    expect(reopened.scheduledMatches[0].resultMatchId).toBe(reconciledId);
    expect(reopened.scheduledMatches[0].status).toBe(ScheduledMatchStatus.Accepted);
    expect(matchesWithId(reopened, reconciledId)).toHaveLength(1);
    // The link was not quietly repaired away on the way in.
    expect(reopened.scheduledMatches[0].quarantined).toBe(false);
  });

  test('deletion protection and correction both still work in the reopened file', () => {
    const { tournament, manager, scheduled } = withOneAcceptedResult();

    renameTeamAndCommit(manager, testTeamNames[0], 'Ninety Six Central A');
    const reopened = saveAndReopen(tournament);

    const reopenedRound = reopened.phases[0].rounds[0];
    const reopenedMatch = matchesWithId(reopened, scheduled.resultMatchId)[0];
    expect(reopenedMatch).toBeDefined();

    const reopenedManager = newManager(reopened);
    expect(reopenedManager.deleteMatch(reopenedMatch, reopenedRound)).toBe(false);
    expect(reopenedRound.matches).toContain(reopenedMatch);

    const editor = new TempMatchManager(reopened);
    editor.openModal(reopenedMatch, reopenedRound);
    editor.setNotes('Corrected after reopening.');
    expect(editor.saveExistingMatch(reopenedMatch)).toBe(true);
    expect(reopened.scheduledMatches[0].resultMatchId).toBe(reopenedMatch.id);
  });
});

describe('ordinary renames are not made harder', () => {
  test('a team that has never played renames normally', () => {
    const tournament = makeTestTournament();
    const manager = newManager(tournament);

    renameTeam(manager, testTeamNames[0], 'Ninety Six Central A');

    expect(manager.toasts).toHaveLength(0);
    expect(tournament.findTeamByName('Ninety Six Central A')).toBeDefined();
    expect(tournament.findTeamByName(testTeamNames[0])).toBeUndefined();
  });

  test('a team with only manually entered games renames normally', () => {
    const tournament = makeTestTournament();
    const manager = newManager(tournament);
    const match = playGame(tournament, tournament.phases[0].rounds[0], testTeamNames[0], testTeamNames[1]);

    renameTeam(manager, testTeamNames[0], 'Ninety Six Central A');

    expect(manager.toasts).toHaveLength(0);
    // Nothing durable pointed at this game, so nothing needed rewriting — but the game is still there.
    expect(tournament.phases[0].rounds[0].matches).toContain(match);
    expect(tournament.scheduledMatches).toHaveLength(0);
  });

  test('a scheduled game that has not been accepted renames normally, references and all', () => {
    const tournament = makeTestTournament();
    const manager = newManager(tournament);
    const scheduled = new ScheduledMatch(1, testTeamNames[0], testTeamNames[1]);
    scheduled.status = ScheduledMatchStatus.Ready;
    tournament.scheduledMatches = [scheduled];

    renameTeam(manager, testTeamNames[0], 'Ninety Six Central A');

    expect(manager.toasts).toHaveLength(0);
    expect(scheduled.leftTeamName).toBe('Ninety Six Central A');
    expect(scheduled.status).toBe(ScheduledMatchStatus.Ready);
    expect(scheduled.resultMatchId).toBeUndefined();
  });

  test.each([ScheduledMatchStatus.Playing, ScheduledMatchStatus.Submitted])(
    'a %s room game still blocks the rename, and nothing is half-applied',
    (status) => {
      const tournament = makeTestTournament();
      const manager = newManager(tournament);
      const scheduled = new ScheduledMatch(1, testTeamNames[0], testTeamNames[1]);
      scheduled.status = status;
      tournament.scheduledMatches = [scheduled];

      renameTeam(manager, testTeamNames[0], 'Ninety Six Central A');

      expect(manager.toasts[0]?.severity).toBe('error');
      expect(tournament.findTeamByName(testTeamNames[0])).toBeDefined();
      expect(scheduled.leftTeamName).toBe(testTeamNames[0]);
    },
  );
});
