/**
 * Opening a tournament on the computer that is not the one that died.
 *
 * The .yft records that round 4 was Playing in room 204. It does not record whether that game
 * finished, whether the scorekeeper still has it, or whether the room has already gone home. Every
 * test here is about refusing to assume one of those — because each assumption produces a
 * plausible-looking tournament that is quietly missing or duplicating a game.
 */
import { describe, expect, test } from 'vitest';
import Tournament from '../renderer/DataModel/Tournament';
import { ScheduledMatch, ScheduledMatchStatus } from '../renderer/DataModel/ScheduledMatch';
import { TournamentRoom } from '../renderer/DataModel/TournamentRoom';
import { ISessionSummary, SessionDisplayState, SessionStatus } from '../main/server/ServerTypes';
import { findStrandedGames, restartScheduledGame } from '../renderer/Services/StandbyRecovery';
import { repairOperationalIntegrity } from '../renderer/Services/OperationalIntegrity';
import { makeTestTournament, testTeamNames } from './TestFixtures';

const [teamA, teamB, teamC, teamD] = testTeamNames;

/** A tournament as a replacement computer finds it: mid-round, with no server state at all. */
function reopenedTournament(): Tournament {
  const tournament = makeTestTournament();
  tournament.roomScoringMode = 'browser';
  const room = new TournamentRoom('Room 204', 0);
  tournament.rooms = [room];

  const playing = new ScheduledMatch(2, teamA, teamB, 'sched-playing');
  playing.roomId = room.id;
  playing.status = ScheduledMatchStatus.Playing;

  const submitted = new ScheduledMatch(2, teamC, teamD, 'sched-submitted');
  submitted.status = ScheduledMatchStatus.Submitted;

  tournament.scheduledMatches = [playing, submitted];
  return tournament;
}

function sessionFor(scheduledMatchId: string, status: SessionStatus, sessionId = 'session-1'): ISessionSummary {
  return {
    sessionId,
    roundNumber: 2,
    leftTeam: teamA,
    rightTeam: teamB,
    scheduledMatchId,
    status,
    displayState: SessionDisplayState.Live,
    createdAt: '2026-08-07T10:00:00.000Z',
    lastSeenAt: '2026-08-07T10:05:00.000Z',
    msSinceLastSeen: 0,
    score: null,
  };
}

const noEvidence = { sessions: [], inboxSessionIds: [] };

describe('what a replacement computer finds', () => {
  test('a Playing game with no session is reported for the director', () => {
    const stranded = findStrandedGames(reopenedTournament(), noEvidence);

    const playing = stranded.find((game) => game.scheduledMatchId === 'sched-playing');
    expect(playing?.kind).toBe('playing');
    expect(playing?.roomName).toBe('Room 204');
    expect(playing?.guidance).toContain('QBJ');
  });

  test('a Submitted game with no recoverable final is reported for the director', () => {
    const stranded = findStrandedGames(reopenedTournament(), noEvidence);

    expect(stranded.find((game) => game.scheduledMatchId === 'sched-submitted')?.kind).toBe('submitted');
  });

  test('nothing is silently made Ready or Accepted just by being found', () => {
    const tournament = reopenedTournament();

    findStrandedGames(tournament, noEvidence);

    expect(tournament.scheduledMatches.map((scheduled) => scheduled.status)).toEqual([
      ScheduledMatchStatus.Playing,
      ScheduledMatchStatus.Submitted,
    ]);
  });

  test('the integrity pass does not reset an interrupted game either', () => {
    // This is the other place a well-meaning repair could quietly restart a played game.
    const tournament = reopenedTournament();

    repairOperationalIntegrity(tournament);

    expect(tournament.scheduledMatches.map((scheduled) => scheduled.status)).toEqual([
      ScheduledMatchStatus.Playing,
      ScheduledMatchStatus.Submitted,
    ]);
  });

  test('a game whose session survived is not stranded', () => {
    const stranded = findStrandedGames(reopenedTournament(), {
      sessions: [sessionFor('sched-playing', SessionStatus.Playing)],
      inboxSessionIds: [],
    });

    expect(stranded.map((game) => game.scheduledMatchId)).toEqual(['sched-submitted']);
  });

  test('a final already waiting in the Match Inbox is not stranded', () => {
    const stranded = findStrandedGames(reopenedTournament(), {
      sessions: [sessionFor('sched-submitted', SessionStatus.Submitted, 'session-inbox')],
      inboxSessionIds: ['session-inbox'],
    });

    expect(stranded.map((game) => game.scheduledMatchId)).toEqual(['sched-playing']);
  });

  test('resolved and not-yet-started games are not reported at all', () => {
    const tournament = reopenedTournament();
    tournament.scheduledMatches[0].status = ScheduledMatchStatus.Ready;
    tournament.scheduledMatches[1].status = ScheduledMatchStatus.Cancelled;

    expect(findStrandedGames(tournament, noEvidence)).toEqual([]);
  });
});

describe('restarting a game that really is unrecoverable', () => {
  test('a Playing game becomes the explicit retry state a room can start again', () => {
    const tournament = reopenedTournament();

    expect(restartScheduledGame(tournament, 'sched-playing')).toEqual({ ok: true });
    expect(tournament.scheduledMatches[0].status).toBe(ScheduledMatchStatus.NeedsAttention);
  });

  test('a Submitted game can be restarted too', () => {
    const tournament = reopenedTournament();

    expect(restartScheduledGame(tournament, 'sched-submitted')).toEqual({ ok: true });
    expect(tournament.scheduledMatches[1].status).toBe(ScheduledMatchStatus.NeedsAttention);
  });

  test('an accepted result is never restarted', () => {
    const tournament = reopenedTournament();
    const [scheduled] = tournament.scheduledMatches;
    scheduled.status = ScheduledMatchStatus.Accepted;
    scheduled.resultMatchId = 'match-1';

    const restarted = restartScheduledGame(tournament, 'sched-playing');

    expect(restarted).toEqual({ ok: false, reason: expect.stringContaining('accepted result') });
    expect(scheduled.status).toBe(ScheduledMatchStatus.Accepted);
    expect(scheduled.resultMatchId).toBe('match-1');
  });

  test('a cancelled game is refused', () => {
    const tournament = reopenedTournament();
    tournament.scheduledMatches[0].status = ScheduledMatchStatus.Cancelled;

    expect(restartScheduledGame(tournament, 'sched-playing').ok).toBe(false);
  });

  test('restarting twice is harmless', () => {
    const tournament = reopenedTournament();

    restartScheduledGame(tournament, 'sched-playing');

    expect(restartScheduledGame(tournament, 'sched-playing')).toEqual({ ok: true });
    expect(tournament.scheduledMatches[0].status).toBe(ScheduledMatchStatus.NeedsAttention);
  });

  test('a game that is not there is refused rather than silently ignored', () => {
    expect(restartScheduledGame(reopenedTournament(), 'sched-nope').ok).toBe(false);
  });
});
