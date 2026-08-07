/**
 * An accepted official result cannot be deleted through the ordinary game-delete path.
 *
 * An accepted `ScheduledMatch` and the `Match` it points at are two halves of one record. Deleting
 * the `Match` on its own leaves the Match Plan asserting an official result for a game that is no
 * longer in the tournament, and nothing downstream — standings, the stat report, QBJ export — has
 * any way to notice. The guard therefore lives in the mutation, not in the button: these tests call
 * the delete function directly, the way another caller would.
 *
 * The other half of the property matters just as much. An ordinary game — entered by hand, imported
 * from a file, or scheduled but not yet accepted — must still delete normally. Match Plan existing
 * is not a reason to make every game permanent.
 */
import { describe, expect, test } from 'vitest';
import { TournamentManager } from '../renderer/TournamentManager';
import { Match } from '../renderer/DataModel/Match';
import { Round } from '../renderer/DataModel/Round';
import { ScheduledMatch, ScheduledMatchStatus } from '../renderer/DataModel/ScheduledMatch';
import { TempMatchManager } from '../renderer/Modal Managers/TempMatchManager';
import Tournament from '../renderer/DataModel/Tournament';
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

interface IFixture {
  manager: TestTournamentManager;
  tournament: Tournament;
  round: Round;
  match: Match;
}

/** A manager holding a tournament with one game already entered in round 1. */
function withOneGame(): IFixture {
  const manager = new TestTournamentManager();
  const tournament = makeTestTournament();
  manager.tournament = tournament;
  manager.toasts = [];
  manager.makeToast = (message: string, severity?: string) => {
    manager.toasts.push({ message, severity });
  };

  const round = tournament.phases[0].rounds[0];
  const left = tournament.findTeamByName(testTeamNames[0]);
  const right = tournament.findTeamByName(testTeamNames[1]);
  if (!left || !right) throw new Error('Test teams were not created');
  const match = new Match(left, right, tournament.scoringRules.answerTypes);
  round.addMatch(match);

  return { manager, tournament, round, match };
}

/** Link the game to an accepted scheduled match, the way accepting a room submission does. */
function makeOfficial(tournament: Tournament, round: Round, match: Match): ScheduledMatch {
  const scheduled = new ScheduledMatch(
    round.number,
    match.leftTeam.team?.name ?? '',
    match.rightTeam.team?.name ?? '',
    'scheduled-official',
  );
  scheduled.status = ScheduledMatchStatus.Accepted;
  scheduled.resultMatchId = match.id;
  tournament.scheduledMatches = [scheduled];
  return scheduled;
}

describe('ordinary games still delete', () => {
  test('a manually entered game deletes', () => {
    const { manager, round, match } = withOneGame();

    expect(manager.deleteMatch(match, round)).toBe(true);
    expect(round.matches).toHaveLength(0);
  });

  test('an imported game deletes', () => {
    const { manager, round, match } = withOneGame();
    match.importedFile = 'round-1.qbj';

    expect(manager.deleteMatch(match, round)).toBe(true);
    expect(round.matches).toHaveLength(0);
  });

  test('a scheduled game that has not been accepted deletes', () => {
    const { manager, tournament, round, match } = withOneGame();
    const scheduled = makeOfficial(tournament, round, match);
    scheduled.status = ScheduledMatchStatus.Submitted;

    expect(manager.deleteMatch(match, round)).toBe(true);
    expect(round.matches).toHaveLength(0);
  });

  test('an accepted scheduled game linked to some other match does not protect this one', () => {
    const { manager, tournament, round, match } = withOneGame();
    const scheduled = makeOfficial(tournament, round, match);
    scheduled.resultMatchId = 'some-other-match';

    expect(manager.deleteMatch(match, round)).toBe(true);
    expect(round.matches).toHaveLength(0);
  });
});

describe('an accepted official result is protected', () => {
  test('the delete mutation itself refuses, not just the confirmation dialog', () => {
    const { manager, tournament, round, match } = withOneGame();
    makeOfficial(tournament, round, match);

    expect(manager.deleteMatch(match, round)).toBe(false);
  });

  test('the game and its schedule link both survive the attempt', () => {
    const { manager, tournament, round, match } = withOneGame();
    const scheduled = makeOfficial(tournament, round, match);

    manager.deleteMatch(match, round);

    expect(round.matches).toEqual([match]);
    expect(scheduled.status).toBe(ScheduledMatchStatus.Accepted);
    expect(scheduled.resultMatchId).toBe(match.id);
    // The link still resolves: no dangling resultMatchId.
    expect(round.matches.some((candidate) => candidate.id === scheduled.resultMatchId)).toBe(true);
  });

  test('the refusal points at the correction workflow rather than just saying no', () => {
    const { manager, tournament, round, match } = withOneGame();
    makeOfficial(tournament, round, match);

    manager.deleteMatch(match, round);

    expect(manager.toasts).toHaveLength(1);
    expect(manager.toasts[0].severity).toBe('error');
    expect(manager.toasts[0].message).toContain('accepted official result');
    expect(manager.toasts[0].message).toContain('Correct official result');
  });

  test('the confirmation path refuses up front instead of opening a dialog it would then ignore', () => {
    const { manager, tournament, round, match } = withOneGame();
    makeOfficial(tournament, round, match);
    let dialogOpened = false;
    manager.genericModalManager.open = () => {
      dialogOpened = true;
    };

    manager.tryDeleteMatch(match, round);

    expect(dialogOpened).toBe(false);
    expect(round.matches).toEqual([match]);
    expect(manager.toasts).toHaveLength(1);
  });

  test('an ordinary game still gets its confirmation dialog', () => {
    const { manager, round, match } = withOneGame();
    let dialogOpened = false;
    manager.genericModalManager.open = () => {
      dialogOpened = true;
    };

    manager.tryDeleteMatch(match, round);

    expect(dialogOpened).toBe(true);
    expect(manager.toasts).toHaveLength(0);
  });
});

describe('correction remains the way to fix an official result', () => {
  test('saving a correction updates the existing match in place', () => {
    const { tournament, round, match } = withOneGame();
    const scheduled = makeOfficial(tournament, round, match);
    const editor = new TempMatchManager(tournament);

    editor.openModal(match, round);
    editor.setNotes('Corrected from the signed scoresheet.');
    expect(editor.saveExistingMatch(match)).toBe(true);

    expect(round.matches).toEqual([match]);
    expect(match.notes).toBe('Corrected from the signed scoresheet.');
    expect(scheduled.status).toBe(ScheduledMatchStatus.Accepted);
    expect(scheduled.resultMatchId).toBe(match.id);
  });
});
