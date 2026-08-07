/**
 * Turning a recovered QBJ file back into a tournament result.
 *
 * The whole value of the emergency download is that a director can put the game back where it
 * belongs afterwards. The whole danger of it is that "where it belongs" is a guess, and a guess
 * that lands on the wrong scheduled game produces a standings table that is wrong in a way nobody
 * looks for. So these tests are mostly about when the software refuses to guess.
 */
import { describe, expect, test } from 'vitest';
import Tournament from '../renderer/DataModel/Tournament';
import { ScheduledMatch, ScheduledMatchStatus, transitionScheduledMatch } from '../renderer/DataModel/ScheduledMatch';
import { TournamentRoom } from '../renderer/DataModel/TournamentRoom';
import MatchImportService from '../renderer/Services/MatchImportService';
import MatchImportResult, { ImportResultStatus } from '../renderer/DataModel/MatchImportResult';
import {
  commitScheduledResult,
  identityOfImportResult,
  suggestScheduledMatch,
  suggestScheduledMatchForImport,
} from '../renderer/Services/ScheduledResultReconciliation';
import { makeModaqQbjMatch, makeTestTournament, testTeamNames } from './TestFixtures';

const [teamA, teamB, teamC, teamD] = testTeamNames;

function tournamentWithSchedule(): Tournament {
  const tournament = makeTestTournament();
  tournament.roomScoringMode = 'browser';
  const room = new TournamentRoom('Room 204', 0);
  tournament.rooms = [room];
  const scheduled = new ScheduledMatch(2, teamA, teamB, 'sched-a');
  scheduled.roomId = room.id;
  scheduled.status = ScheduledMatchStatus.Ready;
  tournament.scheduledMatches = [scheduled];
  return tournament;
}

/** A well-formed MODAQ payload between any two of the test teams. */
function qbjBetween(left: string, right: string) {
  const line = (name: string, bonusPoints: number, tens: number) => ({
    name,
    bonusPoints,
    players: [
      { name: `${name} Player 1`, tossupsHeard: 20, buzzes: [[10, tens]] as [number, number][] },
      { name: `${name} Player 2`, tossupsHeard: 20, buzzes: [] as [number, number][] },
    ],
  });
  return makeModaqQbjMatch({ tossupsRead: 20, left: line(left, 100, 6), right: line(right, 60, 4) });
}

/** Run a MODAQ payload through the ordinary importer, exactly as the manual workflow does. */
function importOneFile(tournament: Tournament, left: string, right: string, roundNumber = 2): MatchImportResult {
  const round = tournament.getRoundObjByNumber(roundNumber);
  const { results } = new MatchImportService(tournament).importMatches(
    [{ filePath: 'R02_Room-204.qbj', fileContents: JSON.stringify(qbjBetween(left, right)) }],
    round,
  );
  return results[0];
}

describe('finding the game a file belongs to', () => {
  test('one unresolved scheduled game is offered', () => {
    const tournament = tournamentWithSchedule();

    const outcome = suggestScheduledMatchForImport(tournament, importOneFile(tournament, teamA, teamB));

    expect(outcome.kind).toBe('candidate');
    if (outcome.kind !== 'candidate') return;
    expect(outcome.suggestion.scheduledMatchId).toBe('sched-a');
    expect(outcome.suggestion.roomName).toBe('Room 204');
  });

  test('a game with no scheduled counterpart is an ordinary import', () => {
    const tournament = tournamentWithSchedule();

    const outcome = suggestScheduledMatchForImport(tournament, importOneFile(tournament, teamC, teamD));

    expect(outcome.kind).toBe('none');
  });

  test('two scheduled games for the same pairing are never auto-linked', () => {
    const tournament = tournamentWithSchedule();
    const duplicate = new ScheduledMatch(2, teamA, teamB, 'sched-b');
    duplicate.status = ScheduledMatchStatus.Ready;
    tournament.scheduledMatches.push(duplicate);

    const outcome = suggestScheduledMatchForImport(tournament, importOneFile(tournament, teamA, teamB));

    expect(outcome).toEqual({ kind: 'ambiguous', count: 2 });
  });

  test('a room narrows an otherwise ambiguous pair, but only when the source knew it', () => {
    const tournament = tournamentWithSchedule();
    const duplicate = new ScheduledMatch(2, teamA, teamB, 'sched-b');
    duplicate.status = ScheduledMatchStatus.Ready;
    tournament.scheduledMatches.push(duplicate);
    const roomId = tournament.rooms[0].id;

    const withRoom = suggestScheduledMatch(tournament, {
      roundNumber: 2,
      leftTeam: teamA,
      rightTeam: teamB,
      roomId,
    });
    const withoutRoom = suggestScheduledMatch(tournament, { roundNumber: 2, leftTeam: teamA, rightTeam: teamB });

    expect(withRoom.kind).toBe('candidate');
    expect(withoutRoom.kind).toBe('ambiguous');
  });

  test('team order in the file does not matter', () => {
    const tournament = tournamentWithSchedule();

    const outcome = suggestScheduledMatchForImport(tournament, importOneFile(tournament, teamB, teamA));

    expect(outcome.kind).toBe('candidate');
  });

  test('an accepted result with nothing left unresolved is reported rather than offered', () => {
    const tournament = tournamentWithSchedule();
    const [scheduled] = tournament.scheduledMatches;
    scheduled.status = ScheduledMatchStatus.Accepted;
    scheduled.resultMatchId = 'match-1';

    const outcome = suggestScheduledMatchForImport(tournament, importOneFile(tournament, teamA, teamB));

    expect(outcome).toEqual({ kind: 'accepted', scheduledMatchId: 'sched-a' });
  });

  test('an accepted first meeting alongside an unresolved rematch is ambiguous, not accepted', () => {
    // Two teams can legitimately meet twice in a round. With one meeting recorded and one still to
    // play, this file could be either — a re-export of the recorded game or the rematch's result —
    // and nothing in the payload distinguishes them.
    const tournament = tournamentWithSchedule();
    const [first] = tournament.scheduledMatches;
    first.status = ScheduledMatchStatus.Accepted;
    first.resultMatchId = 'match-1';
    const rematch = new ScheduledMatch(2, teamA, teamB, 'sched-tb');
    rematch.status = ScheduledMatchStatus.Ready;
    tournament.scheduledMatches.push(rematch);

    const outcome = suggestScheduledMatchForImport(tournament, importOneFile(tournament, teamA, teamB));

    expect(outcome).toEqual({ kind: 'ambiguous', count: 2 });
  });

  test('a room that identifies only the unresolved rematch resolves the ambiguity', () => {
    const tournament = tournamentWithSchedule();
    const [first] = tournament.scheduledMatches;
    first.status = ScheduledMatchStatus.Accepted;
    first.resultMatchId = 'match-1';
    const tiebreakerRoom = new TournamentRoom('Room 118', 1);
    tournament.rooms.push(tiebreakerRoom);
    const rematch = new ScheduledMatch(2, teamA, teamB, 'sched-tb');
    rematch.status = ScheduledMatchStatus.Ready;
    rematch.roomId = tiebreakerRoom.id;
    tournament.scheduledMatches.push(rematch);

    const outcome = suggestScheduledMatch(tournament, {
      roundNumber: 2,
      leftTeam: teamA,
      rightTeam: teamB,
      roomId: tiebreakerRoom.id,
    });

    expect(outcome.kind).toBe('candidate');
    expect(outcome.kind === 'candidate' && outcome.suggestion.scheduledMatchId).toBe('sched-tb');
  });

  test('a room holding both meetings stays ambiguous', () => {
    // The rematch happened in the same room as the first game, so the room narrows nothing.
    const tournament = tournamentWithSchedule();
    const [first] = tournament.scheduledMatches;
    first.status = ScheduledMatchStatus.Accepted;
    first.resultMatchId = 'match-1';
    const rematch = new ScheduledMatch(2, teamA, teamB, 'sched-tb');
    rematch.status = ScheduledMatchStatus.Ready;
    rematch.roomId = first.roomId;
    tournament.scheduledMatches.push(rematch);

    const outcome = suggestScheduledMatch(tournament, {
      roundNumber: 2,
      leftTeam: teamA,
      rightTeam: teamB,
      roomId: first.roomId,
    });

    expect(outcome.kind).toBe('ambiguous');
  });

  test('a cancelled game is not a candidate', () => {
    const tournament = tournamentWithSchedule();
    tournament.scheduledMatches[0].status = ScheduledMatchStatus.Cancelled;

    expect(suggestScheduledMatchForImport(tournament, importOneFile(tournament, teamA, teamB)).kind).toBe('none');
  });

  test('a quarantined game needs review rather than an import', () => {
    const tournament = tournamentWithSchedule();
    tournament.scheduledMatches[0].quarantine('Its pairing is invalid.');

    expect(suggestScheduledMatchForImport(tournament, importOneFile(tournament, teamA, teamB)).kind).toBe('none');
  });

  test('an interrupted game is recognized as interrupted', () => {
    const tournament = tournamentWithSchedule();
    transitionScheduledMatch(tournament.scheduledMatches[0], ScheduledMatchStatus.Playing);

    const outcome = suggestScheduledMatchForImport(tournament, importOneFile(tournament, teamA, teamB));

    expect(outcome.kind === 'candidate' && outcome.suggestion.interrupted).toBe(true);
  });

  test('a file the importer could not resolve has no identity to match on', () => {
    const empty = new MatchImportResult('broken.qbj');
    empty.markFatal('nope');

    expect(identityOfImportResult(empty)).toBeNull();
    expect(suggestScheduledMatch(tournamentWithSchedule(), null).kind).toBe('none');
  });
});

describe('recording a file as the scheduled result', () => {
  function officialMatches(tournament: Tournament) {
    return tournament.phases.flatMap((phase) => phase.rounds.flatMap((round) => round.matches));
  }

  test('creates exactly one Match, linked to exactly one scheduled game', () => {
    const tournament = tournamentWithSchedule();
    const result = importOneFile(tournament, teamA, teamB);

    const committed = commitScheduledResult(tournament, result, 'sched-a');

    expect(committed.ok).toBe(true);
    const matches = officialMatches(tournament);
    expect(matches).toHaveLength(1);
    const [scheduled] = tournament.scheduledMatches;
    expect(scheduled.status).toBe(ScheduledMatchStatus.Accepted);
    expect(scheduled.resultMatchId).toBe(matches[0].id);
    expect(scheduled.roomNameAtPlay).toBe('Room 204');
  });

  test('resolves a game that was interrupted mid-play, with no session involved', () => {
    const tournament = tournamentWithSchedule();
    transitionScheduledMatch(tournament.scheduledMatches[0], ScheduledMatchStatus.Playing);
    const result = importOneFile(tournament, teamA, teamB);

    expect(commitScheduledResult(tournament, result, 'sched-a').ok).toBe(true);
    expect(tournament.scheduledMatches[0].status).toBe(ScheduledMatchStatus.Accepted);
  });

  test('resolves a game left Submitted by a server that never came back', () => {
    const tournament = tournamentWithSchedule();
    const [scheduled] = tournament.scheduledMatches;
    transitionScheduledMatch(scheduled, ScheduledMatchStatus.Playing);
    transitionScheduledMatch(scheduled, ScheduledMatchStatus.Submitted);
    const result = importOneFile(tournament, teamA, teamB);

    expect(commitScheduledResult(tournament, result, 'sched-a').ok).toBe(true);
    expect(scheduled.status).toBe(ScheduledMatchStatus.Accepted);
  });

  test('resolves a game marked NeedsAttention', () => {
    const tournament = tournamentWithSchedule();
    const [scheduled] = tournament.scheduledMatches;
    transitionScheduledMatch(scheduled, ScheduledMatchStatus.Playing);
    transitionScheduledMatch(scheduled, ScheduledMatchStatus.NeedsAttention);
    const result = importOneFile(tournament, teamA, teamB);

    expect(commitScheduledResult(tournament, result, 'sched-a').ok).toBe(true);
    expect(scheduled.status).toBe(ScheduledMatchStatus.Accepted);
  });

  test('cannot replace an accepted result', () => {
    const tournament = tournamentWithSchedule();
    const first = importOneFile(tournament, teamA, teamB);
    commitScheduledResult(tournament, first, 'sched-a');

    const second = importOneFile(tournament, teamA, teamB);
    const committed = commitScheduledResult(tournament, second, 'sched-a');

    expect(committed).toEqual({ ok: false, reason: expect.stringContaining('accepted result') });
    expect(officialMatches(tournament)).toHaveLength(1);
  });

  test('refuses a file whose round does not match the scheduled game', () => {
    const tournament = tournamentWithSchedule();
    const result = importOneFile(tournament, teamA, teamB, 2);
    tournament.scheduledMatches[0].roundNumber = 3;

    const committed = commitScheduledResult(tournament, result, 'sched-a');

    expect(committed).toEqual({ ok: false, reason: expect.stringContaining('round') });
    expect(officialMatches(tournament)).toHaveLength(0);
  });

  test('refuses a file whose teams do not match the scheduled game', () => {
    const tournament = tournamentWithSchedule();
    const result = importOneFile(tournament, teamC, teamD);

    const committed = commitScheduledResult(tournament, result, 'sched-a');

    expect(committed).toEqual({ ok: false, reason: expect.stringContaining('teams') });
    expect(officialMatches(tournament)).toHaveLength(0);
  });

  test('a scheduled rematch between the same teams can be recovered from a file', () => {
    // The Match Plan says these teams meet twice this round — a tiebreaker. Refusing the second
    // result because "this round already has a game between these teams" would make the rematch
    // impossible to recover, which is the whole point of having the file.
    const tournament = tournamentWithSchedule();
    const first = importOneFile(tournament, teamA, teamB);
    commitScheduledResult(tournament, first, 'sched-a');
    const rematch = new ScheduledMatch(2, teamA, teamB, 'sched-tb');
    rematch.status = ScheduledMatchStatus.Ready;
    tournament.scheduledMatches.push(rematch);

    const second = importOneFile(tournament, teamA, teamB);
    const committed = commitScheduledResult(tournament, second, 'sched-tb');

    expect(committed.ok).toBe(true);
    expect(officialMatches(tournament)).toHaveLength(2);
    expect(rematch.status).toBe(ScheduledMatchStatus.Accepted);
    expect(rematch.resultMatchId).not.toBe(tournament.scheduledMatches[0].resultMatchId);
  });

  test('refuses one more result than the schedule says these teams play', () => {
    // One scheduled meeting, one recorded result: a further file is a duplicate import, and the
    // Match Plan's own count is what says so.
    const tournament = tournamentWithSchedule();
    const first = importOneFile(tournament, teamA, teamB);
    commitScheduledResult(tournament, first, 'sched-a');
    const extra = new ScheduledMatch(2, teamA, teamB, 'sched-extra');
    extra.status = ScheduledMatchStatus.Ready;
    // Cancelled meetings do not entitle the round to another result.
    const cancelled = new ScheduledMatch(2, teamA, teamB, 'sched-cancelled');
    cancelled.status = ScheduledMatchStatus.Cancelled;
    tournament.scheduledMatches.push(cancelled);

    const second = importOneFile(tournament, teamA, teamB);
    const committed = commitScheduledResult(tournament, second, 'sched-a');

    expect(committed.ok).toBe(false);
    expect(officialMatches(tournament)).toHaveLength(1);
    expect(extra.status).toBe(ScheduledMatchStatus.Ready);
  });

  test('refuses a third result when only two meetings are scheduled', () => {
    const tournament = tournamentWithSchedule();
    const rematch = new ScheduledMatch(2, teamA, teamB, 'sched-tb');
    rematch.status = ScheduledMatchStatus.Ready;
    tournament.scheduledMatches.push(rematch);
    commitScheduledResult(tournament, importOneFile(tournament, teamA, teamB), 'sched-a');
    commitScheduledResult(tournament, importOneFile(tournament, teamA, teamB), 'sched-tb');
    const third = new ScheduledMatch(2, teamA, teamB, 'sched-third');
    third.status = ScheduledMatchStatus.Ready;

    const committed = commitScheduledResult(tournament, importOneFile(tournament, teamA, teamB), 'sched-tb');

    expect(committed.ok).toBe(false);
    expect(officialMatches(tournament)).toHaveLength(2);
    expect(third.status).toBe(ScheduledMatchStatus.Ready);
  });

  test('a recovered game records only the filename, like an ordinary import', () => {
    const tournament = tournamentWithSchedule();
    const result = importOneFile(tournament, teamA, teamB);

    commitScheduledResult(tournament, result, 'sched-a');

    expect(officialMatches(tournament)[0].importedFile).toBe('R02_Room-204.qbj');
  });

  test('a refused import leaves the scheduled game exactly as it was', () => {
    const tournament = tournamentWithSchedule();
    const [scheduled] = tournament.scheduledMatches;
    scheduled.quarantine('needs review');
    const result = importOneFile(tournament, teamA, teamB);

    const committed = commitScheduledResult(tournament, result, 'sched-a');

    expect(committed.ok).toBe(false);
    expect(scheduled.status).toBe(ScheduledMatchStatus.NeedsAttention);
    expect(scheduled.resultMatchId).toBeUndefined();
    expect(officialMatches(tournament)).toHaveLength(0);
  });

  test('a file with fatal errors is refused outright', () => {
    const tournament = tournamentWithSchedule();
    const result = importOneFile(tournament, teamA, teamB);
    result.status = ImportResultStatus.FatalErr;

    expect(commitScheduledResult(tournament, result, 'sched-a').ok).toBe(false);
  });
});
