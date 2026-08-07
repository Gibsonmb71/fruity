/**
 * A room whose final is waiting on tournament control is not a broken room.
 *
 * This exercises the whole of that state over real HTTP — start, submit, keep polling — because the
 * bug it guards against was an HTTP-level one: the assignment endpoint answered 409 for a submitted
 * game, and the browser, which quite reasonably treats a failed request as a failed request, told
 * the scorekeeper their Chromebook had lost the network. The separation being pinned down here is
 * that GET describes state and POST enforces it.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import TournamentServer from '../main/server/TournamentServer';
import {
  IAssignmentDescriptor,
  IMatchSubmission,
  IRoomDescriptor,
  ITournamentSnapshot,
  RoomBlockedReason,
  SessionStatus,
  deviceIdHeader,
  roomTokenHeader,
  sessionTokenHeader,
} from '../main/server/ServerTypes';
import { ScheduledMatchStatus } from '../renderer/DataModel/ScheduledMatch';
import scoringRulesToModaqGameFormat from '../renderer/Services/YellowFruitScoringRulesToModaq';
import { CommonRuleSets, ScoringRules } from '../renderer/DataModel/ScoringRules';
import { makeModaqQbjMatch, testTeamNames } from './TestFixtures';

const rooms: IRoomDescriptor[] = [
  { id: 'room-101', name: 'Room 101', accessToken: 'token-for-101', pairingCode: '48271934', enabled: true },
];

function makeAssignments(): IAssignmentDescriptor[] {
  return [
    {
      scheduledMatchId: 'sched-r1',
      roomId: 'room-101',
      roundNumber: 1,
      roundName: '1',
      leftTeam: testTeamNames[0],
      rightTeam: testTeamNames[1],
      status: ScheduledMatchStatus.Scheduled,
    },
    {
      scheduledMatchId: 'sched-r2',
      roomId: 'room-101',
      roundNumber: 2,
      roundName: '2',
      leftTeam: testTeamNames[0],
      rightTeam: testTeamNames[2],
      status: ScheduledMatchStatus.Scheduled,
    },
  ];
}

function makeSnapshot(overrides: Partial<ITournamentSnapshot> = {}): ITournamentSnapshot {
  const formatResult = scoringRulesToModaqGameFormat(new ScoringRules(CommonRuleSets.AcfPowers));
  return {
    name: 'Ninety Six Invitational',
    rounds: [1, 2, 3].map((n) => ({ number: n, name: String(n) })),
    teams: testTeamNames.map((name) => ({
      name,
      players: [{ name: `${name} Player 1` }, { name: `${name} Player 2` }],
    })),
    gameFormat: formatResult.ok ? formatResult.gameFormat : null,
    gameFormatErrors: formatResult.ok ? [] : formatResult.errors,
    gameFormatWarnings: formatResult.ok ? formatResult.warnings : [],
    timedRounds: false,
    roomScoringMode: 'browser',
    rooms,
    assignments: makeAssignments(),
    currentRoundNumber: 1,
    releasedRoundNumber: 1,
    ...overrides,
  };
}

let server: TournamentServer;
let baseUrl: string;
let bundleDir: string;
let submissions: IMatchSubmission[];

beforeEach(async () => {
  submissions = [];
  bundleDir = mkdtempSync(path.join(tmpdir(), 'yf-room-submitted-'));
  writeFileSync(path.join(bundleDir, 'index.html'), '<!doctype html><title>Room</title>');

  server = new TournamentServer({
    roomBundleDirectory: bundleDir,
    onFinalSubmission: (s) => submissions.push(s),
  });
  server.setTournamentSnapshot(makeSnapshot());
  await server.start(0);
  baseUrl = `http://127.0.0.1:${(server as any).server.address().port}`;
});

afterEach(async () => {
  await server.stop();
  rmSync(bundleDir, { recursive: true, force: true });
});

async function getAssignment(deviceId = 'device-a') {
  const res = await fetch(`${baseUrl}/api/v1/rooms/room-101/assignment`, {
    headers: { [roomTokenHeader]: 'token-for-101', [deviceIdHeader]: deviceId },
  });
  return { res, body: await res.json().catch(() => null) };
}

async function startMatch(scheduledMatchId: string) {
  const res = await fetch(`${baseUrl}/api/v1/rooms/room-101/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [roomTokenHeader]: 'token-for-101' },
    body: JSON.stringify({ scheduledMatchId }),
  });
  return { res, body: await res.json().catch(() => null) };
}

function finalPayload() {
  return makeModaqQbjMatch({
    left: {
      name: testTeamNames[0],
      bonusPoints: 40,
      players: [{ name: `${testTeamNames[0]} Player 1`, tossupsHeard: 20, buzzes: [[10, 4]] }],
    },
    right: {
      name: testTeamNames[1],
      bonusPoints: 30,
      players: [{ name: `${testTeamNames[1]} Player 1`, tossupsHeard: 20, buzzes: [[10, 3]] }],
    },
  });
}

async function submitFinal(credentials: { sessionId: string; token: string }) {
  return fetch(`${baseUrl}/api/v1/sessions/${credentials.sessionId}/final`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [sessionTokenHeader]: credentials.token },
    body: JSON.stringify(finalPayload()),
  });
}

/** Get the room all the way to "final submitted, waiting on control". */
async function submitTheCurrentGame() {
  const { body: session } = await startMatch('sched-r1');
  const final = await submitFinal(session);
  expect(final.status).toBe(200);
  return session as { sessionId: string; token: string };
}

describe('polling while a final is awaiting review', () => {
  test('the assignment endpoint answers normally rather than with an HTTP failure', async () => {
    await submitTheCurrentGame();

    const { res, body } = await getAssignment();

    expect(res.status).toBe(200);
    expect(body.error).toBeUndefined();
    // The room is still who it says it is, and still knows what it is holding.
    expect(body.roomName).toBe('Room 101');
    expect(body.current.scheduledMatchId).toBe('sched-r1');
  });

  test('the response says the game is with tournament control', async () => {
    const session = await submitTheCurrentGame();

    const { body } = await getAssignment();

    expect(body.session.sessionId).toBe(session.sessionId);
    expect(body.session.status).toBe(SessionStatus.Submitted);
    expect(body.session.finalReceived).toBe(true);
    expect(body.blockedReason).toBe(RoomBlockedReason.Submitted);
    expect(body.blockedMessage).toContain('awaiting tournament-control review');
  });

  test('presence and help stay part of the same response, so those keep working', async () => {
    await submitTheCurrentGame();

    const { body } = await getAssignment();

    expect(body.presence.roomId).toBe('room-101');
    expect(body.presence.connected).toBe(true);
    expect(body.helpRequest).toBeNull();
  });

  test('a room can still raise a help request while waiting', async () => {
    await submitTheCurrentGame();

    const res = await fetch(`${baseUrl}/api/v1/rooms/room-101/help`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [roomTokenHeader]: 'token-for-101',
        [deviceIdHeader]: 'device-a',
      },
      body: JSON.stringify({ category: 'scoring-problem', message: 'Wrong bonus total' }),
    });

    expect(res.status).toBe(200);
    const { body } = await getAssignment();
    expect(body.helpRequest.category).toBe('scoring-problem');
  });

  test('the awaiting-review state survives repeated polling, the way a reloaded page recovers', async () => {
    const session = await submitTheCurrentGame();

    await getAssignment();
    await getAssignment();
    const { res, body } = await getAssignment();

    expect(res.status).toBe(200);
    expect(body.session.sessionId).toBe(session.sessionId);
    expect(body.session.status).toBe(SessionStatus.Submitted);
    expect(server.getSessionSummaries()).toHaveLength(1);
  });
});

describe('starting remains refused by the server', () => {
  test('a submitted assignment cannot be started again', async () => {
    await submitTheCurrentGame();

    const { res, body } = await startMatch('sched-r1');

    expect(res.status).toBe(409);
    expect(body.blockedReason).toBe(RoomBlockedReason.Submitted);
  });

  test('a refused start creates no second session and no second submission', async () => {
    await submitTheCurrentGame();

    await startMatch('sched-r1');
    await startMatch('sched-r1');

    expect(server.getSessionSummaries()).toHaveLength(1);
    expect(submissions).toHaveLength(1);
  });

  test('the snapshot flipping the assignment to Submitted keeps the start refused', async () => {
    await submitTheCurrentGame();
    const assignments = makeAssignments();
    assignments[0].status = ScheduledMatchStatus.Submitted;
    server.setTournamentSnapshot(makeSnapshot({ assignments }));

    const poll = await getAssignment();
    const start = await startMatch('sched-r1');

    expect(poll.res.status).toBe(200);
    expect(poll.body.blockedReason).toBe(RoomBlockedReason.Submitted);
    expect(start.res.status).toBe(409);
  });
});

describe('lifecycle outcomes carry the game they belong to', () => {
  test('an acceptance names its scheduled match', async () => {
    const session = await submitTheCurrentGame();
    server.acceptSession(session.sessionId);

    const { body } = await getAssignment();

    expect(body.lastOutcome.status).toBe(SessionStatus.Accepted);
    expect(body.lastOutcome.scheduledMatchId).toBe('sched-r1');
  });

  test('a rejection names its scheduled match and carries the reason', async () => {
    const session = await submitTheCurrentGame();
    server.rejectSession(session.sessionId, 'Player TUH does not match the team total.');

    const { body } = await getAssignment();

    expect(body.lastOutcome.status).toBe(SessionStatus.Rejected);
    expect(body.lastOutcome.scheduledMatchId).toBe('sched-r1');
    expect(body.lastOutcome.rejectionReason).toBe('Player TUH does not match the team total.');
  });

  test('a rejected game becomes startable again, without the stale session', async () => {
    const session = await submitTheCurrentGame();
    server.rejectSession(session.sessionId, 'Wrong teams');
    const assignments = makeAssignments();
    assignments[0].status = ScheduledMatchStatus.NeedsAttention;
    server.setTournamentSnapshot(makeSnapshot({ assignments }));

    const poll = await getAssignment();
    const start = await startMatch('sched-r1');

    expect(poll.body.blockedReason).toBeUndefined();
    expect(poll.body.session).toBeNull();
    expect(start.res.status).toBe(201);
  });
});
