/**
 * A room whose server disappears in the middle of a round.
 *
 * The pieces are wired together the way the Electron app wires them, with a real HTTP server that
 * gets stopped and started again underneath a room that is holding a live session. What is being
 * checked is the sequence a scorekeeper actually lives through: the game keeps working, the result
 * lands on the Chromebook before anything is uploaded, the upload fails harmlessly, the file can be
 * downloaded and handed over, and when the server comes back the same result — not a second copy —
 * reaches tournament control.
 *
 * The last part is the one worth having a real server for. Idempotency at the browser and
 * idempotency at the server are two different mechanisms, and a test that stubs the server proves
 * only that the browser did not send twice.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import TournamentServer from '../main/server/TournamentServer';
import {
  IMatchSubmission,
  ITournamentSnapshot,
  SessionStatus,
  roomTokenHeader,
  sessionTokenHeader,
} from '../main/server/ServerTypes';
import { ScheduledMatchStatus } from '../renderer/DataModel/ScheduledMatch';
import RoomResultOutbox, { OutboxDeliverFn } from '../room/OutboxStore';
import { createMemoryDriver, IOutboxDriver } from '../room/OutboxStorage';
import { outboxQbjFileContents, outboxQbjFileName } from '../room/QbjBackup';
import { buildScoringKit, isScoringKitUsable } from '../room/ScoringKit';
import { IModaqGameFormat } from '../renderer/Services/YellowFruitScoringRulesToModaq';
import { makeModaqQbjMatch, testTeamNames } from './TestFixtures';

const [teamA, teamB] = testTeamNames;

const gameFormat = {
  regulationTossupCount: 20,
  minimumOvertimeQuestionCount: 1,
} as unknown as IModaqGameFormat;

const roomToken = 'room-token-204';
const roomId = 'room-204';
const scheduledMatchId = 'sched-r4';

let server: TournamentServer;
let bundleDir: string;
let baseUrl: string;
let submissions: IMatchSubmission[];

function snapshot(): ITournamentSnapshot {
  return {
    name: 'Ninety Six Invitational',
    rounds: [
      { number: 4, name: '4' },
      { number: 5, name: '5' },
    ],
    teams: [
      { name: teamA, players: [{ name: `${teamA} Player 1` }] },
      { name: teamB, players: [{ name: `${teamB} Player 1` }] },
    ],
    gameFormat,
    gameFormatErrors: [],
    gameFormatWarnings: [],
    timedRounds: false,
    roomScoringMode: 'browser',
    rooms: [{ id: roomId, name: 'Room 204', accessToken: roomToken, enabled: true }],
    assignments: [
      {
        scheduledMatchId,
        roomId,
        roundNumber: 4,
        roundName: '4',
        leftTeam: teamA,
        rightTeam: teamB,
        status: ScheduledMatchStatus.Ready,
      },
    ],
    currentRoundNumber: 4,
    releasedRoundNumber: 4,
    recoveryKey: 'tourn-1',
  };
}

function finalQbj() {
  const line = (name: string, bonusPoints: number, tens: number) => ({
    name,
    bonusPoints,
    players: [{ name: `${name} Player 1`, tossupsHeard: 20, buzzes: [[10, tens]] as [number, number][] }],
  });
  return makeModaqQbjMatch({ tossupsRead: 20, left: line(teamA, 100, 6), right: line(teamB, 60, 4) });
}

beforeEach(async () => {
  submissions = [];
  bundleDir = mkdtempSync(path.join(tmpdir(), 'yf-outage-'));
  writeFileSync(path.join(bundleDir, 'index.html'), '<!doctype html><title>Room</title>');
  server = new TournamentServer({
    roomBundleDirectory: bundleDir,
    // The real app keeps this in app-data so a restart can hand a room its session back. Without
    // it, "the server came back" and "the server was replaced" would be the same test.
    recoveryFilePath: path.join(bundleDir, 'recovery.json'),
    onFinalSubmission: (submission) => submissions.push(submission),
  });
  server.setTournamentSnapshot(snapshot());
  const status = await server.start(0);
  baseUrl = `http://127.0.0.1:${status.port}`;
});

afterEach(async () => {
  await server.stop();
  rmSync(bundleDir, { recursive: true, force: true });
});

/** Start the assigned game the way the room page does, and keep its credentials. */
async function startAssignedGame(): Promise<{ sessionId: string; token: string }> {
  const response = await fetch(`${baseUrl}/api/v1/rooms/${roomId}/sessions`, {
    method: 'POST',
    headers: { [roomTokenHeader]: roomToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ scheduledMatchId }),
  });
  const body = (await response.json()) as { sessionId: string; token: string };
  return { sessionId: body.sessionId, token: body.token };
}

/**
 * Deliver over real HTTP, exactly as the room's own delivery function does.
 *
 * A stopped server produces a connection failure here rather than a stubbed one, which is the
 * whole point: the classification that decides "retry" versus "keep it and tell the scorekeeper"
 * is being asked about a real failure.
 */
function httpDelivery(): OutboxDeliverFn {
  return async (entry) => {
    if (!entry.sessionCredentials) return { ok: false, status: 409, error: 'No session for this result.' };
    try {
      const response = await fetch(`${baseUrl}/api/v1/sessions/${entry.sessionCredentials.sessionId}/final`, {
        method: 'POST',
        headers: { [sessionTokenHeader]: entry.sessionCredentials.token, 'Content-Type': 'application/json' },
        body: JSON.stringify(entry.qbj),
      });
      if (!response.ok) {
        return { ok: false, status: response.status, error: `The server refused the request (${response.status}).` };
      }
      const body = (await response.json()) as { newSubmission: boolean };
      return { ok: true, newSubmission: body.newSubmission };
    } catch {
      return { ok: false, error: 'Could not reach the YellowFruit computer.' };
    }
  };
}

/** A clock the tests advance by hand, so the retry backoff is exercised without waiting for it. */
function fakeClock(startMs = Date.parse('2026-08-07T10:00:00.000Z')) {
  let current = startMs;
  return {
    now: () => new Date(current),
    advance: (ms: number) => {
      current += ms;
    },
  };
}

function makeOutbox(driver: IOutboxDriver, now: () => Date = () => new Date()) {
  let counter = 0;
  return new RoomResultOutbox(driver, {
    legacyStorage: null,
    now,
    newId: () => {
      counter += 1;
      return `result-${counter}`;
    },
  });
}

describe('a game that is under way when the server goes down', () => {
  test('the result is saved locally, downloadable, and delivered once when the server returns', async () => {
    const driver = createMemoryDriver(true);
    // One clock for both the original page and the reloaded one, so "time passed" is the only
    // difference between them rather than an accident of when the test happened to run.
    const clock = fakeClock();
    const outbox = makeOutbox(driver, clock.now);
    const credentials = await startAssignedGame();

    // The server goes away mid-game. The room does not find out until it next tries to talk to it.
    await server.stop();

    // The scorekeeper finishes the game. Persist first, then attempt the upload.
    const enqueued = await outbox.enqueue({
      roomId,
      scheduledMatchId,
      roundNumber: 4,
      roundName: '4',
      leftTeam: teamA,
      rightTeam: teamB,
      qbj: finalQbj(),
      deliveryState: 'queued',
      sessionCredentials: credentials,
    });
    expect(enqueued.persisted).toBe(true);
    // Persisted means persisted: a reload right now still finds the game.
    expect((await driver.readAll()).length).toBe(1);

    const afterFailedUpload = await outbox.deliverOne(enqueued.entry.id, httpDelivery());
    expect(afterFailedUpload?.deliveryState).toBe('queued');
    expect(afterFailedUpload?.retryBlocked).toBeUndefined();

    // The scorekeeper can hand the game over as a file without waiting for anything.
    const fileName = outboxQbjFileName(afterFailedUpload!, 'Room 204');
    expect(fileName).toBe('R04_Room-204_Ninety-Six-A_vs_Greenwood-A.qbj');
    const downloaded = JSON.parse(outboxQbjFileContents(afterFailedUpload!)) as Record<string, unknown>;
    expect(downloaded.match_teams).toHaveLength(2);
    expect(JSON.stringify(downloaded)).not.toContain(credentials.token);

    // The server comes back. Sessions are restored from the recovery store, so the room's
    // credentials still work and the queued result goes through on the next retry.
    const restarted = await server.start(0);
    baseUrl = `http://127.0.0.1:${restarted.port}`;
    server.setTournamentSnapshot(snapshot());

    // A reloaded page over the same storage, with time moved past the first retry's backoff.
    const reloaded = makeOutbox(driver, clock.now);
    await reloaded.load();
    clock.advance(60_000);
    const flushed = await reloaded.flush(httpDelivery());

    expect(flushed.delivered).toBe(1);
    expect(reloaded.find(enqueued.entry.id)?.deliveryState).toBe('submitted');
    expect(submissions).toHaveLength(1);
    expect(submissions[0].scheduledMatchId).toBe(scheduledMatchId);
  });

  test('a retry after a lost response does not create a second game', async () => {
    const outbox = makeOutbox(createMemoryDriver(true));
    const credentials = await startAssignedGame();
    const qbj = finalQbj();

    const enqueued = await outbox.enqueue({
      roomId,
      scheduledMatchId,
      roundNumber: 4,
      roundName: '4',
      leftTeam: teamA,
      rightTeam: teamB,
      qbj,
      deliveryState: 'queued',
      sessionCredentials: credentials,
    });

    // The upload lands but the answer never arrives, so the room tries the identical payload again.
    await outbox.deliverOne(enqueued.entry.id, httpDelivery());
    const secondAttempt = await httpDelivery()({ ...enqueued.entry, qbj });

    expect(secondAttempt).toEqual({ ok: true, newSubmission: false });
    // One submission reached tournament control, not two.
    expect(submissions).toHaveLength(1);
  });

  test('a session the server no longer knows about stops retrying but keeps the result', async () => {
    const outbox = makeOutbox(createMemoryDriver(true));
    const credentials = await startAssignedGame();

    // A replacement computer that never had the old server's recovery state: the server is up and
    // answering, but it has never heard of this session.
    await server.stop();
    const replacement = await server.start(0);
    baseUrl = `http://127.0.0.1:${replacement.port}`;
    server.sessions.clear();
    server.setTournamentSnapshot(snapshot());

    const enqueued = await outbox.enqueue({
      roomId,
      scheduledMatchId,
      roundNumber: 4,
      roundName: '4',
      leftTeam: teamA,
      rightTeam: teamB,
      qbj: finalQbj(),
      deliveryState: 'queued',
      sessionCredentials: credentials,
    });
    const delivered = await outbox.deliverOne(enqueued.entry.id, httpDelivery());

    expect(delivered?.retryBlocked).toBe(true);
    // Nothing is discarded. The file is now the route back into the tournament.
    expect(outbox.list()).toHaveLength(1);
    expect(JSON.parse(outboxQbjFileContents(delivered!))).toHaveProperty('match_teams');
  });
});

describe('emergency scoring from cached tournament data', () => {
  test('a cached kit lets a game be scored, saved and exported with no server at all', async () => {
    const kit = buildScoringKit({
      tournamentKey: 'Ninety Six Invitational',
      tournamentName: 'Ninety Six Invitational',
      gameFormat,
      timedRounds: false,
      teams: snapshot().teams,
      rounds: snapshot().rounds,
      roomId,
      roomName: 'Room 204',
    });
    expect(isScoringKitUsable(kit)).toBe(true);

    await server.stop();
    const outbox = makeOutbox(createMemoryDriver(true));

    // The scorekeeper picks a round and two teams from the kit and scores the game.
    const round = kit.rounds.find((candidate) => candidate.number === 5);
    const enqueued = await outbox.enqueue({
      tournamentKey: kit.tournamentName,
      roundNumber: round?.number,
      roundName: round?.name,
      leftTeam: kit.teams[0].name,
      rightTeam: kit.teams[1].name,
      qbj: finalQbj(),
      deliveryState: 'manual-backup',
    });

    expect(enqueued.persisted).toBe(true);
    expect(outbox.find(enqueued.entry.id)?.deliveryState).toBe('manual-backup');

    // Non-authoritative by construction: there is no session, so nothing ever uploads it.
    const flushed = await outbox.flush(httpDelivery());
    expect(flushed.attempted).toBe(0);
    expect(outbox.find(enqueued.entry.id)?.deliveryState).toBe('manual-backup');

    // It leaves the device as an ordinary QBJ file for a human to import.
    expect(outboxQbjFileName(enqueued.entry, kit.roomName)).toBe('R05_Room-204_Ninety-Six-A_vs_Greenwood-A.qbj');
    expect(JSON.parse(outboxQbjFileContents(enqueued.entry))).toHaveProperty('match_teams');
  });

  test('with no cached kit, emergency scoring is refused rather than guessed at', () => {
    expect(isScoringKitUsable(null)).toBe(false);
  });
});

describe('the server stays the only authority', () => {
  test('a submitted local copy changes to accepted only when acceptance is applied', async () => {
    const outbox = makeOutbox(createMemoryDriver(true));
    const credentials = await startAssignedGame();
    const enqueued = await outbox.enqueue({
      roomId,
      scheduledMatchId,
      roundNumber: 4,
      roundName: '4',
      leftTeam: teamA,
      rightTeam: teamB,
      qbj: finalQbj(),
      deliveryState: 'queued',
      sessionCredentials: credentials,
    });

    await outbox.deliverOne(enqueued.entry.id, httpDelivery());
    // A delivered result is submitted, not accepted: tournament control has not looked at it yet.
    expect(outbox.find(enqueued.entry.id)?.deliveryState).toBe('submitted');

    server.acceptSession(credentials.sessionId);
    expect(server.sessions.get(credentials.sessionId)?.status).toBe(SessionStatus.Accepted);
    // This test intentionally exercises the local state-machine step directly; assignment-poll
    // integration is covered elsewhere.
    await outbox.markAccepted(enqueued.entry.id);
    expect(outbox.find(enqueued.entry.id)?.deliveryState).toBe('accepted');
  });
});
