/**
 * Getting a game back from the server when the device that scored it has lost its copy.
 *
 * This is the second recovery source, behind the browser's own event history, and it exists for one
 * failure: a Chromebook whose localStorage was cleared, corrupted, or written by a profile that has
 * since been reset. The first-party scorer's snapshots carry its complete event list inside the
 * QBJ, so what comes back is the real scoresheet rather than a summary.
 *
 * Run against a real HTTP server because the interesting half is the authorization. A recovery
 * endpoint that could be read without the session's own token would turn every room browser on the
 * LAN into a reader of every other room's live game.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import TournamentServer from '../main/server/TournamentServer';
import {
  ISessionRecoveryResponse,
  ITournamentSnapshot,
  roomTokenHeader,
  sessionTokenHeader,
} from '../main/server/ServerTypes';
import { ScheduledMatchStatus } from '../renderer/DataModel/ScheduledMatch';
import { IModaqGameFormat } from '../renderer/Services/YellowFruitScoringRulesToModaq';
import { attachScorerRecovery, readScorerRecovery } from '../room/scorer/ScorerRecovery';
import { IGameSetup } from '../room/scoring/deriveGame';
import { ScoreEvent } from '../room/scoring/ScoreEvents';
import { makeModaqQbjMatch, testTeamNames } from './TestFixtures';

const [teamA, teamB] = testTeamNames;
const roomToken = 'room-token-recovery';
const otherRoomToken = 'room-token-other';
const roomId = 'room-204';
const otherRoomId = 'room-118';
const scheduledMatchId = 'sched-r4';
const otherScheduledMatchId = 'sched-r4-other';

let server: TournamentServer;
let bundleDir: string;
let baseUrl: string;

const gameFormat = { regulationTossupCount: 20, minimumOvertimeQuestionCount: 1 } as unknown as IModaqGameFormat;

function snapshot(): ITournamentSnapshot {
  const assignment = (id: string, room: string) => ({
    scheduledMatchId: id,
    roomId: room,
    roundNumber: 4,
    roundName: '4',
    leftTeam: teamA,
    rightTeam: teamB,
    status: ScheduledMatchStatus.Ready,
  });
  return {
    name: 'Ninety Six Invitational',
    rounds: [{ number: 4, name: '4' }],
    teams: [
      { name: teamA, players: [{ name: `${teamA} Player 1` }] },
      { name: teamB, players: [{ name: `${teamB} Player 1` }] },
    ],
    gameFormat,
    gameFormatErrors: [],
    gameFormatWarnings: [],
    scoringFormat: null,
    timedRounds: false,
    roomScoringMode: 'browser',
    rooms: [
      { id: roomId, name: 'Room 204', accessToken: roomToken, enabled: true },
      { id: otherRoomId, name: 'Room 118', accessToken: otherRoomToken, enabled: true },
    ],
    assignments: [assignment(scheduledMatchId, roomId), assignment(otherScheduledMatchId, otherRoomId)],
    currentRoundNumber: 4,
    releasedRoundNumber: 4,
    recoveryKey: 'tourn-1',
  };
}

const setup: IGameSetup = {
  left: { name: teamA, players: [`${teamA} Player 1`] },
  right: { name: teamB, players: [`${teamB} Player 1`] },
};

const events: ScoreEvent[] = [
  {
    id: 'ev-1',
    type: 'tossup-buzz',
    questionNumber: 1,
    team: 'left',
    playerName: `${teamA} Player 1`,
    answerTypeIndex: 0,
  },
  { id: 'ev-2', type: 'bonus', questionNumber: 1, team: 'left', controlledPoints: 20, bouncebackPoints: 0 },
];

/** The score line a QBJ Match carries for one team. Content is beside the point here. */
function line(name: string) {
  return {
    name,
    bonusPoints: 20,
    players: [{ name: `${name} Player 1`, tossupsHeard: 1, buzzes: [[10, 1]] as [number, number][] }],
  };
}

function plainQbj(tossupsRead: number) {
  return makeModaqQbjMatch({ tossupsRead, left: line(teamA), right: line(teamB) });
}

/** A snapshot exactly as the first-party scorer sends one: an ordinary QBJ with its events inside. */
function liveSnapshot(): object {
  return attachScorerRecovery(plainQbj(1), setup, events);
}

beforeEach(async () => {
  bundleDir = mkdtempSync(path.join(tmpdir(), 'yf-session-recovery-'));
  writeFileSync(path.join(bundleDir, 'index.html'), '<!doctype html><title>Room</title>');
  server = new TournamentServer({
    roomBundleDirectory: bundleDir,
    recoveryFilePath: path.join(bundleDir, 'recovery.json'),
    onFinalSubmission: () => undefined,
  });
  server.setTournamentSnapshot(snapshot());
  const status = await server.start(0);
  baseUrl = `http://127.0.0.1:${status.port}`;
});

afterEach(async () => {
  await server.stop();
  rmSync(bundleDir, { recursive: true, force: true });
});

async function startGame(room: string, token: string, matchId: string) {
  const response = await fetch(`${baseUrl}/api/v1/rooms/${room}/sessions`, {
    method: 'POST',
    headers: { [roomTokenHeader]: token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ scheduledMatchId: matchId }),
  });
  if (!response.ok) throw new Error(`Could not start test session: ${response.status}`);
  return (await response.json()) as { sessionId: string; token: string };
}

async function putSnapshot(sessionId: string, token: string, payload: object) {
  const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/snapshot`, {
    method: 'PUT',
    headers: { [sessionTokenHeader]: token, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Could not write test snapshot: ${response.status}`);
}

function recover(sessionId: string, token: string) {
  return fetch(`${baseUrl}/api/v1/sessions/${sessionId}/recovery`, { headers: { [sessionTokenHeader]: token } });
}

describe('recovering a session from the server', () => {
  test('the owning room gets its own game back, events and all', async () => {
    const credentials = await startGame(roomId, roomToken, scheduledMatchId);
    await putSnapshot(credentials.sessionId, credentials.token, liveSnapshot());

    const response = await recover(credentials.sessionId, credentials.token);
    expect(response.status).toBe(200);
    const body = (await response.json()) as ISessionRecoveryResponse;
    expect(body.sessionId).toBe(credentials.sessionId);
    expect(body.scheduledMatchId).toBe(scheduledMatchId);
    expect(body.finalReceived).toBe(false);

    // The point of preferring our own snapshots: what comes back is the event history, not a total.
    const restored = readScorerRecovery(body.latestQbj as object, setup);
    expect(restored?.events.map((event) => event.id)).toEqual(['ev-1', 'ev-2']);
  });

  test('it never echoes the capability token back', async () => {
    const credentials = await startGame(roomId, roomToken, scheduledMatchId);
    const response = await recover(credentials.sessionId, credentials.token);
    const body = (await response.json()) as Record<string, unknown>;

    expect(JSON.stringify(body)).not.toContain(credentials.token);
    expect(body.token).toBeUndefined();
  });

  test('a session that has never sent anything recovers to nothing rather than to an error', async () => {
    const credentials = await startGame(roomId, roomToken, scheduledMatchId);

    const response = await recover(credentials.sessionId, credentials.token);
    expect(response.status).toBe(200);
    expect(((await response.json()) as ISessionRecoveryResponse).latestQbj).toBeNull();
  });
});

describe('what it refuses', () => {
  test('the wrong token', async () => {
    const credentials = await startGame(roomId, roomToken, scheduledMatchId);

    expect((await recover(credentials.sessionId, 'not-the-token')).status).toBe(403);
  });

  test('no token at all', async () => {
    const credentials = await startGame(roomId, roomToken, scheduledMatchId);

    const response = await fetch(`${baseUrl}/api/v1/sessions/${credentials.sessionId}/recovery`);
    expect(response.status).toBe(403);
  });

  test("another room's session, even with that room's own valid credentials", async () => {
    const mine = await startGame(roomId, roomToken, scheduledMatchId);
    const theirs = await startGame(otherRoomId, otherRoomToken, otherScheduledMatchId);

    // Holding a perfectly good token proves nothing about somebody else's game.
    expect((await recover(theirs.sessionId, mine.token)).status).toBe(403);
    expect((await recover(mine.sessionId, theirs.token)).status).toBe(403);
  });

  test('a session that does not exist', async () => {
    const credentials = await startGame(roomId, roomToken, scheduledMatchId);

    expect((await recover('no-such-session', credentials.token)).status).toBe(404);
  });

  test('a method other than GET', async () => {
    const credentials = await startGame(roomId, roomToken, scheduledMatchId);

    const response = await fetch(`${baseUrl}/api/v1/sessions/${credentials.sessionId}/recovery`, {
      method: 'DELETE',
      headers: { [sessionTokenHeader]: credentials.token },
    });
    expect(response.status).toBe(405);
  });
});

describe('what a recovered payload can be turned back into', () => {
  test('a snapshot from another scorer is not reconstructed into invented events', async () => {
    const credentials = await startGame(roomId, roomToken, scheduledMatchId);
    // A plain MODAQ-shaped QBJ: real, importable, and carrying no first-party event history.
    await putSnapshot(credentials.sessionId, credentials.token, plainQbj(4));

    const body = (await (await recover(credentials.sessionId, credentials.token)).json()) as ISessionRecoveryResponse;
    expect(body.latestQbj).not.toBeNull();
    expect(readScorerRecovery(body.latestQbj as object, setup)).toBeNull();
  });

  test('a payload for different teams is refused rather than opened against this game', async () => {
    const credentials = await startGame(roomId, roomToken, scheduledMatchId);
    await putSnapshot(credentials.sessionId, credentials.token, liveSnapshot());

    const body = (await (await recover(credentials.sessionId, credentials.token)).json()) as ISessionRecoveryResponse;
    const wrongTeams: IGameSetup = {
      left: { name: 'Somebody Else', players: ['A Player'] },
      right: { name: 'Another Team', players: ['B Player'] },
    };
    expect(readScorerRecovery(body.latestQbj as object, wrongTeams)).toBeNull();
  });
});
