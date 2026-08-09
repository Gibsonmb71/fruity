import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { connect } from 'net';
import path from 'path';
import TournamentServer from '../main/server/TournamentServer';
import {
  IMatchSubmission,
  ITournamentSnapshot,
  SessionStatus,
  maxRequestBodyBytes,
  sessionTokenHeader,
} from '../main/server/ServerTypes';
import scoringRulesToModaqGameFormat from '../renderer/Services/YellowFruitScoringRulesToModaq';
import scoringRulesToScorekeeperFormat from '../renderer/Services/ScorekeeperFormat';
import { CommonRuleSets, ScoringRules } from '../renderer/DataModel/ScoringRules';
import { makeModaqCycleExport, makeStandardModaqMatch, testTeamNames } from './TestFixtures';
import type { IPublicLiveSnapshot } from '../shared/LiveTypes';

const publicSnapshot: IPublicLiveSnapshot = {
  version: 1,
  tournamentName: 'Test Tournament',
  lastUpdatedAt: '2026-08-05T15:00:00.000Z',
  latestCompletedRound: null,
  teamStandings: [],
  individualStandings: [],
  phaseStandings: [],
  recentResults: [],
  nextRound: null,
  settings: {
    slides: { teamStandings: true, individuals: true, pools: true, recentResults: true, nextRound: true },
    slideDurationSeconds: 10,
    rowsPerSlide: 10,
    theme: 'system',
    showLastUpdated: true,
  },
  metricLabels: { teamPpg: 'PP20TUH', individualPptuh: 'PP20TUH', teamPpb: 'PPB' },
};

/** Snapshot matching the test fixtures: 3 rounds, 4 teams, ACF-with-powers rules */
function makeSnapshot(): ITournamentSnapshot {
  const rules = new ScoringRules(CommonRuleSets.AcfPowers);
  const formatResult = scoringRulesToModaqGameFormat(rules);
  return {
    name: 'Test Tournament',
    rounds: [1, 2, 3].map((n) => ({ number: n, name: String(n) })),
    teams: testTeamNames.map((name) => ({ name, players: [{ name: `${name} Player 1` }] })),
    gameFormat: formatResult.ok ? formatResult.gameFormat : null,
    gameFormatErrors: formatResult.ok ? [] : formatResult.errors,
    gameFormatWarnings: formatResult.ok ? formatResult.warnings : [],
    scoringFormat: scoringRulesToScorekeeperFormat(rules),
    timedRounds: false,
    roomScoringMode: 'browser',
    rooms: [],
    assignments: [],
    currentRoundNumber: 1,
    releasedRoundNumber: 1,
  };
}

let server: TournamentServer;
let baseUrl: string;
let submissions: IMatchSubmission[];
let bundleDir: string;
let liveBundleDir: string;

beforeEach(async () => {
  submissions = [];
  bundleDir = mkdtempSync(path.join(tmpdir(), 'yf-room-bundle-'));
  writeFileSync(path.join(bundleDir, 'index.html'), '<!doctype html><title>Room</title>');
  writeFileSync(path.join(bundleDir, 'room.js'), 'console.log("room");');
  liveBundleDir = mkdtempSync(path.join(tmpdir(), 'yf-live-bundle-'));
  writeFileSync(path.join(liveBundleDir, 'index.html'), '<!doctype html><title>Live</title>');
  writeFileSync(path.join(liveBundleDir, 'live.js'), 'console.log("live");');

  server = new TournamentServer({
    roomBundleDirectory: bundleDir,
    liveBundleDirectory: liveBundleDir,
    onFinalSubmission: (s) => submissions.push(s),
  });
  server.setTournamentSnapshot(makeSnapshot());
  // Port 0 lets the OS pick a free one, so tests never collide with a real server.
  const status = await server.start(0);
  expect(status.running).toBe(true);
  baseUrl = `http://127.0.0.1:${(server as any).server.address().port}`;
});

afterEach(async () => {
  await server.stop();
  rmSync(bundleDir, { recursive: true, force: true });
  rmSync(liveBundleDir, { recursive: true, force: true });
});

/**
 * Send a request over a raw socket, bypassing fetch's URL normalization. Needed for anything that
 * tests how the server handles a hostile request line.
 */
function rawRequest(requestLine: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const { port } = (server as any).server.address();
    const socket = connect(port, '127.0.0.1', () => {
      socket.write(`${requestLine}\r\nHost: localhost\r\nConnection: close\r\n\r\n`);
    });
    let received = '';
    socket.on('data', (chunk) => {
      received += chunk.toString();
    });
    socket.on('end', () => resolve(received));
    socket.on('error', reject);
  });
}

/** Create a session the way the room app does */
async function createSession(overrides: Record<string, unknown> = {}) {
  const res = await fetch(`${baseUrl}/api/v1/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roundNumber: 1, leftTeam: testTeamNames[0], rightTeam: testTeamNames[1], ...overrides }),
  });
  return { res, body: await res.json().catch(() => null) };
}

describe('start and stop', () => {
  test('the server reports itself as running with a port', () => {
    const status = server.getStatus();

    expect(status.running).toBe(true);
    expect(status.errorMessage).toBeUndefined();
  });

  test('stopping shuts down the listener', async () => {
    await server.stop();

    expect(server.getStatus().running).toBe(false);
    await expect(fetch(`${baseUrl}/api/v1/status`)).rejects.toThrow();
  });

  test('stopping discards sessions, since they only mean anything while running', async () => {
    await createSession();
    expect(server.getSessionSummaries()).toHaveLength(1);

    await server.stop();

    expect(server.getSessionSummaries()).toHaveLength(0);
  });

  test('starting twice is harmless', async () => {
    const status = await server.start(0);

    expect(status.running).toBe(true);
  });

  test('concurrent starts coalesce and stop waits for the listener', async () => {
    const candidate = new TournamentServer({ roomBundleDirectory: bundleDir, onFinalSubmission: () => {} });
    candidate.setTournamentSnapshot(makeSnapshot());

    const firstStart = candidate.start(0);
    const secondStart = candidate.start(0);

    expect(secondStart).toBe(firstStart);
    expect((await firstStart).running).toBe(true);
    expect((await candidate.stop()).running).toBe(false);
  });

  test('stop during start and repeated stop calls leave no listener behind', async () => {
    const candidate = new TournamentServer({ roomBundleDirectory: bundleDir, onFinalSubmission: () => {} });
    candidate.setTournamentSnapshot(makeSnapshot());

    const starting = candidate.start(0);
    const stopping = candidate.stop();
    const repeatedStop = candidate.stop();
    const [started, stopped] = await Promise.all([starting, stopping]);

    expect(started.running).toBe(true);
    expect(repeatedStop).toBe(stopping);
    expect(stopped.running).toBe(false);
    expect(candidate.getStatus().running).toBe(false);
  });

  test('failing to bind is reported instead of thrown', async () => {
    const occupiedPort = (server as any).server.address().port;
    const second = new TournamentServer({ roomBundleDirectory: bundleDir, onFinalSubmission: () => {} });
    const status = await second.start(occupiedPort);

    expect(status.running).toBe(false);
    expect(status.errorMessage).toContain('already being used');
    await second.stop();
  });

  test('LAN addresses are http URLs on the chosen port, and exclude loopback', () => {
    const addresses = TournamentServer.getLanAddresses(4732);

    for (const address of addresses) {
      expect(address).toMatch(/^http:\/\/\d+\.\d+\.\d+\.\d+:4732$/);
      expect(address).not.toContain('127.0.0.1');
      expect(address).not.toContain('169.254.');
    }
  });

  test('structured LAN addresses retain the interface label', () => {
    const addresses = TournamentServer.getLanNetworkAddresses(4732);

    for (const address of addresses) {
      expect(address.interfaceName).not.toBe('');
      expect(address.url).toBe(`http://${address.address}:4732`);
    }
  });
});

describe('health endpoint', () => {
  test('GET /api/v1/status returns ok', async () => {
    const res = await fetch(`${baseUrl}/api/v1/status`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  test('a non-GET method is rejected', async () => {
    const res = await fetch(`${baseUrl}/api/v1/status`, { method: 'DELETE' });

    expect(res.status).toBe(405);
  });

  test('an unknown API endpoint is a 404', async () => {
    const res = await fetch(`${baseUrl}/api/v1/nope`);

    expect(res.status).toBe(404);
  });
});

describe('QBSheet CORS', () => {
  test('an approved static origin receives an exact allow-origin header', async () => {
    server.setAllowedQbsheetOrigins(['https://scores.example/']);

    const res = await fetch(`${baseUrl}/api/v1/status`, {
      headers: { Origin: 'https://scores.example' },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://scores.example');
    expect(res.headers.get('vary')).toContain('Origin');
  });

  test('a disallowed origin receives no allow-origin header on a simple request', async () => {
    server.setAllowedQbsheetOrigins(['https://scores.example']);

    const res = await fetch(`${baseUrl}/api/v1/status`, {
      headers: { Origin: 'https://not-approved.example' },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  test('a disallowed preflight is refused, while an approved preflight exposes room headers', async () => {
    server.setAllowedQbsheetOrigins(['https://scores.example']);

    const approved = await fetch(`${baseUrl}/api/v1/join`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://scores.example',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'x-yf-room-token',
      },
    });
    expect(approved.status).toBe(204);
    expect(approved.headers.get('access-control-allow-origin')).toBe('https://scores.example');
    expect(approved.headers.get('access-control-allow-headers')).toContain('x-yf-room-token');

    const refused = await fetch(`${baseUrl}/api/v1/join`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://not-approved.example',
        'Access-Control-Request-Method': 'POST',
      },
    });
    expect(refused.status).toBe(403);
  });
});

describe('read-only tournament endpoints', () => {
  test('GET /connect is a credential-free connectivity check', async () => {
    const res = await fetch(`${baseUrl}/connect`);
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).toContain('YellowFruit server is reachable');
    expect(body).toContain('Test Tournament');
    expect(body).not.toMatch(/token|session|points/i);
  });

  test('GET /api/v1/tournament exposes only what a room needs', async () => {
    const res = await fetch(`${baseUrl}/api/v1/tournament`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.name).toBe('Test Tournament');
    expect(body.gameFormat.negValue).toBe(-5);
    expect(body.roundCount).toBe(3);
    expect(body.teamCount).toBe(4);
    // No internal object graph, no registrations, no existing match data.
    expect(Object.keys(body).sort()).toEqual(
      [
        'gameFormat',
        'gameFormatErrors',
        'gameFormatWarnings',
        'scoringFormat',
        'name',
        'roundCount',
        'teamCount',
        'timedRounds',
      ].sort(),
    );
  });

  test('the scoring rules are served as structural data alongside the MODAQ format', async () => {
    const body = await (await fetch(`${baseUrl}/api/v1/tournament`)).json();

    expect(body.scoringFormat.answerTypes.map((at: { value: number }) => at.value)).toEqual([15, 10, -5]);
    expect(body.scoringFormat.bonus.enabled).toBe(true);
    expect(body.scoringFormat.regulation.tossupCount).toBe(20);
  });

  test('a tournament MODAQ refuses still describes its rules', async () => {
    // Lightning rounds have no representation in MODAQ at all, so gameFormat is null and the legacy
    // scorer cannot run. The rules themselves are still perfectly describable, which is the whole
    // point of carrying both.
    const rules = new ScoringRules(CommonRuleSets.AcfPowers);
    rules.lightningCountPerTeam = 2;
    rules.lightningDivisor = 5;
    const formatResult = scoringRulesToModaqGameFormat(rules);
    server.setTournamentSnapshot({
      ...makeSnapshot(),
      gameFormat: formatResult.ok ? formatResult.gameFormat : null,
      gameFormatErrors: formatResult.ok ? [] : formatResult.errors,
      scoringFormat: scoringRulesToScorekeeperFormat(rules),
    });

    const body = await (await fetch(`${baseUrl}/api/v1/tournament`)).json();

    expect(body.gameFormat).toBeNull();
    expect(body.gameFormatErrors.join(' ')).toContain('lightning');
    expect(body.scoringFormat.lightning).toEqual({ enabled: true, countPerTeam: 2, divisor: 5 });
  });

  test('GET /api/v1/rounds lists the rounds', async () => {
    const body = await (await fetch(`${baseUrl}/api/v1/rounds`)).json();

    expect(body.rounds.map((r: any) => r.number)).toEqual([1, 2, 3]);
  });

  test('GET /api/v1/teams lists teams with rosters', async () => {
    const body = await (await fetch(`${baseUrl}/api/v1/teams`)).json();

    expect(body.teams).toHaveLength(4);
    expect(body.teams[0].players[0].name).toContain('Player 1');
  });
});

describe('public live endpoints', () => {
  test('the public snapshot is read-only and contains no room/session credentials', async () => {
    server.setPublicLiveSnapshot(publicSnapshot);

    const res = await fetch(`${baseUrl}/api/v1/public/snapshot`);
    const body = await res.json();
    const serialized = JSON.stringify(body);

    expect(res.status).toBe(200);
    expect(body).toEqual(publicSnapshot);
    expect(serialized).not.toMatch(/token|session|recovery/i);
  });

  test('disabled Live Display returns no tournament data', async () => {
    const res = await fetch(`${baseUrl}/api/v1/public/snapshot`);

    expect(res.status).toBe(404);
    expect((await res.json()).error).toContain('disabled');
  });

  test('public snapshot cannot be changed over HTTP', async () => {
    server.setPublicLiveSnapshot(publicSnapshot);

    const res = await fetch(`${baseUrl}/api/v1/public/snapshot`, { method: 'POST' });

    expect(res.status).toBe(405);
  });

  test('live audience and display routes serve the separate bundle', async () => {
    server.setPublicLiveSnapshot(publicSnapshot);

    const audience = await fetch(`${baseUrl}/live`);
    const display = await fetch(`${baseUrl}/live/display?mode=standings`);

    expect(audience.status).toBe(200);
    expect(display.status).toBe(200);
    expect(await audience.text()).toContain('<title>Live</title>');
    expect(await display.text()).toContain('<title>Live</title>');
  });

  test('the public projection remains available after a local server restart', async () => {
    server.setPublicLiveSnapshot(publicSnapshot);
    await server.stop();
    const status = await server.start(0);
    baseUrl = `http://127.0.0.1:${(server as any).server.address().port}`;

    expect(status.running).toBe(true);
    expect(await (await fetch(`${baseUrl}/api/v1/public/snapshot`)).json()).toEqual(publicSnapshot);
  });
});

describe('session creation', () => {
  test('a valid request returns a session id and token', async () => {
    const { res, body } = await createSession();

    expect(res.status).toBe(201);
    expect(body.sessionId).toBeTruthy();
    expect(body.token).toBeTruthy();
    expect(body.status).toBe(SessionStatus.Created);
  });

  test('the generic session path refuses an explicitly traditional tournament', async () => {
    server.setTournamentSnapshot({ ...makeSnapshot(), roomScoringMode: 'traditional' });

    const { res, body } = await createSession();

    expect(res.status).toBe(400);
    expect(body.error).toContain('disabled for traditional');
  });

  test('the generic session path refuses an unreleased round', async () => {
    server.setTournamentSnapshot({ ...makeSnapshot(), releasedRoundNumber: null });

    const { res, body } = await createSession();

    expect(res.status).toBe(400);
    expect(body.error).toContain('not been released');
  });

  test('ids and tokens are unguessable and unique', async () => {
    const first = (await createSession()).body;
    const second = (await createSession()).body;

    expect(first.sessionId).not.toBe(second.sessionId);
    expect(first.token).not.toBe(second.token);
    expect(first.token.length).toBeGreaterThanOrEqual(32);
  });

  test('a round outside the tournament is rejected', async () => {
    const { res, body } = await createSession({ roundNumber: 99 });

    expect(res.status).toBe(400);
    expect(body.error).toContain('round');
  });

  test('a team that is not in the tournament is rejected', async () => {
    const { res, body } = await createSession({ leftTeam: 'Some Other School' });

    expect(res.status).toBe(400);
    expect(body.error).toContain('teams in this tournament');
  });

  test('a team cannot play itself', async () => {
    const { res } = await createSession({ rightTeam: testTeamNames[0] });

    expect(res.status).toBe(400);
  });

  test('wrong types are rejected rather than coerced', async () => {
    const { res } = await createSession({ roundNumber: '1' });

    expect(res.status).toBe(400);
  });

  test('MODAQ-incompatible rules start in first-party mode and remain blocked in legacy mode', async () => {
    server.setTournamentSnapshot({
      ...makeSnapshot(),
      gameFormat: null,
      gameFormatErrors: ['Lightning rounds are not supported.'],
    });
    const firstParty = await createSession();
    const legacy = await createSession({ scorer: 'legacy' });

    expect(firstParty.res.status).toBe(201);
    expect(legacy.res.status).toBe(400);
    expect(legacy.body.error).toContain('cannot be used');
  });

  test('GET is not allowed on the sessions collection', async () => {
    const res = await fetch(`${baseUrl}/api/v1/sessions`);

    expect(res.status).toBe(405);
  });
});

describe('request validation', () => {
  test('invalid JSON is a 400', async () => {
    const res = await fetch(`${baseUrl}/api/v1/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ not json',
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('not valid JSON');
  });

  test('a non-JSON content type is a 415', async () => {
    const res = await fetch(`${baseUrl}/api/v1/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: '{}',
    });

    expect(res.status).toBe(415);
  });

  test('an oversized body is rejected', async () => {
    const { body: session } = await createSession();
    const huge = { match_teams: [{ padding: 'x'.repeat(maxRequestBodyBytes + 1024) }] };

    const res = await fetch(`${baseUrl}/api/v1/sessions/${session.sessionId}/snapshot`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', [sessionTokenHeader]: session.token },
      body: JSON.stringify(huge),
    }).catch(() => null);

    // Either the server answers 413 or it destroys the connection; both are acceptable refusals,
    // and either way nothing gets stored.
    if (res) expect(res.status).toBe(413);
    expect(server.sessions.get(session.sessionId)?.latestQbj).toBeNull();
  });

  test('a body that is not a QBJ match is rejected', async () => {
    const { body: session } = await createSession();

    const res = await fetch(`${baseUrl}/api/v1/sessions/${session.sessionId}/snapshot`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', [sessionTokenHeader]: session.token },
      body: JSON.stringify({ something: 'else' }),
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('match_teams');
  });
});

describe('session authorization', () => {
  test('an unknown session is a 404', async () => {
    const res = await fetch(`${baseUrl}/api/v1/sessions/does-not-exist`, {
      headers: { [sessionTokenHeader]: 'whatever' },
    });

    expect(res.status).toBe(404);
  });

  test('reading a session without its token is refused', async () => {
    const { body: session } = await createSession();

    const res = await fetch(`${baseUrl}/api/v1/sessions/${session.sessionId}`);

    expect(res.status).toBe(403);
  });

  test("a room cannot write to another room's session", async () => {
    const roomA = (await createSession()).body;
    const roomB = (await createSession({ roundNumber: 2, leftTeam: testTeamNames[2], rightTeam: testTeamNames[3] }))
      .body;

    const res = await fetch(`${baseUrl}/api/v1/sessions/${roomA.sessionId}/final`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [sessionTokenHeader]: roomB.token },
      body: JSON.stringify(makeStandardModaqMatch()),
    });

    expect(res.status).toBe(403);
    expect(submissions).toHaveLength(0);
    expect(server.sessions.get(roomA.sessionId)?.status).toBe(SessionStatus.Created);
  });

  test('a room can read its own session', async () => {
    const { body: session } = await createSession();

    const res = await fetch(`${baseUrl}/api/v1/sessions/${session.sessionId}`, {
      headers: { [sessionTokenHeader]: session.token },
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.roundNumber).toBe(1);
    // The token is never echoed back.
    expect(body.token).toBeUndefined();
  });
});

describe('snapshots', () => {
  /** PUT a live snapshot for a session */
  function putSnapshot(session: any, qbj: unknown = makeStandardModaqMatch()) {
    return fetch(`${baseUrl}/api/v1/sessions/${session.sessionId}/snapshot`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', [sessionTokenHeader]: session.token },
      body: JSON.stringify(qbj),
    });
  }

  test('a snapshot moves the session to playing and records a score', async () => {
    const { body: session } = await createSession();

    const res = await putSnapshot(session);

    expect(res.status).toBe(200);
    const summary = server.getSessionSummaries()[0];
    expect(summary.status).toBe(SessionStatus.Playing);
    expect(summary.score?.leftPoints).toBe(265);
    expect(summary.score?.rightPoints).toBe(155);
    expect(summary.score?.tossupsRead).toBe(20);
  });

  test('snapshots replace rather than accumulate, so repeating one is idempotent', async () => {
    const { body: session } = await createSession();

    await putSnapshot(session);
    await putSnapshot(session);
    await putSnapshot(session);

    // One session, one snapshot, and crucially no candidate matches.
    expect(server.getSessionSummaries()).toHaveLength(1);
    expect(submissions).toHaveLength(0);
  });

  test('a timer snapshot never counts as a completed game', async () => {
    const { body: session } = await createSession();

    await putSnapshot(session);

    expect(submissions).toHaveLength(0);
    expect(server.sessions.get(session.sessionId)?.finalReceived).toBe(false);
  });

  test('POST is not allowed on the snapshot endpoint', async () => {
    const { body: session } = await createSession();

    const res = await fetch(`${baseUrl}/api/v1/sessions/${session.sessionId}/snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [sessionTokenHeader]: session.token },
      body: JSON.stringify(makeStandardModaqMatch()),
    });

    expect(res.status).toBe(405);
  });
});

describe('final submissions', () => {
  /** POST a final result for a session */
  function postFinal(session: any, qbj: unknown = makeStandardModaqMatch()) {
    return fetch(`${baseUrl}/api/v1/sessions/${session.sessionId}/final`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [sessionTokenHeader]: session.token },
      body: JSON.stringify(qbj),
    });
  }

  test("a final submission reaches the host with the session's round and teams", async () => {
    const { body: session } = await createSession();

    const res = await postFinal(session);

    expect(res.status).toBe(200);
    expect(submissions).toHaveLength(1);
    expect(submissions[0].sessionId).toBe(session.sessionId);
    // The round comes from the session, not from the QBJ, because MODAQ omits _round.
    expect(submissions[0].roundNumber).toBe(1);
    expect(submissions[0].leftTeam).toBe(testTeamNames[0]);
    expect((submissions[0].qbj as any).match_teams).toHaveLength(2);
  });

  test('the session moves to submitted', async () => {
    const { body: session } = await createSession();

    await postFinal(session);

    expect((await postFinal(session).then(() => server.sessions.get(session.sessionId)))?.status).toBe(
      SessionStatus.Submitted,
    );
  });

  test('submitting the same final twice does not create a second candidate match', async () => {
    const { body: session } = await createSession();

    const first = await postFinal(session);
    const second = await postFinal(session);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect((await first.json()).newSubmission).toBe(true);
    expect((await second.json()).newSubmission).toBe(false);
    expect(submissions).toHaveLength(1);
  });

  test('a retry after acceptance is acknowledged without reopening the game', async () => {
    const { body: session } = await createSession();
    await postFinal(session);
    server.acceptSession(session.sessionId);

    const res = await postFinal(session);

    expect(res.status).toBe(200);
    expect((await res.json()).newSubmission).toBe(false);
    expect(submissions).toHaveLength(1);
    expect(server.sessions.get(session.sessionId)?.status).toBe(SessionStatus.Accepted);
  });

  test('an accepted session stops taking snapshots', async () => {
    const { body: session } = await createSession();
    await postFinal(session);
    server.acceptSession(session.sessionId);

    const res = await fetch(`${baseUrl}/api/v1/sessions/${session.sessionId}/snapshot`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', [sessionTokenHeader]: session.token },
      body: JSON.stringify(makeStandardModaqMatch()),
    });

    expect(res.status).toBe(409);
  });

  test('a rejected session can submit again', async () => {
    const { body: session } = await createSession();
    await postFinal(session);
    server.rejectSession(session.sessionId, 'Wrong teams selected');
    expect(server.sessions.get(session.sessionId)?.rejectionReason).toBe('Wrong teams selected');

    const res = await postFinal(session);

    expect(res.status).toBe(200);
    expect((await res.json()).newSubmission).toBe(true);
    expect(submissions).toHaveLength(2);
  });
});

describe('question counts on incoming submissions', () => {
  /**
   * A tied game as MODAQ really exports it from a scaffold packet: `playableCycles` never found a
   * checkpoint where the score wasn't tied, so it handed back the packet's whole padded capacity.
   */
  function makeInflatedTiedGame() {
    return makeModaqCycleExport({
      cycleCount: 40,
      playedIndices: Array.from({ length: 23 }, (_, i) => i),
      left: { name: testTeamNames[0], starters: [`${testTeamNames[0]} Player 1`] },
      right: { name: testTeamNames[1], starters: [`${testTeamNames[1]} Player 1`] },
    });
  }

  test('the server corrects an inflated final rather than storing the scaffold size', async () => {
    const { body: session } = await createSession();
    const inflated = makeInflatedTiedGame();
    expect(inflated.tossups_read).toBe(40);

    const res = await fetch(`${baseUrl}/api/v1/sessions/${session.sessionId}/final`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [sessionTokenHeader]: session.token },
      body: JSON.stringify(inflated),
    });

    expect(res.status).toBe(200);
    // 20 regulation plus the 3 overtime questions that were actually heard.
    const submitted = submissions[0].qbj as any;
    expect(submitted.tossups_read).toBe(23);
    expect(submitted.match_questions).toHaveLength(23);
    expect(submitted.match_teams[0].match_players[0].tossups_heard).toBe(23);
  });

  test('an inflated live snapshot reports the corrected count to the dashboard', async () => {
    const { body: session } = await createSession();

    await fetch(`${baseUrl}/api/v1/sessions/${session.sessionId}/snapshot`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', [sessionTokenHeader]: session.token },
      body: JSON.stringify(makeInflatedTiedGame()),
    });

    expect(server.getSessionSummaries()[0].score?.tossupsRead).toBe(23);
  });

  test('a normal 20-tossup game is stored unchanged', async () => {
    const { body: session } = await createSession();
    const normal = makeModaqCycleExport({
      cycleCount: 20,
      playedIndices: Array.from({ length: 20 }, (_, i) => i),
      left: { name: testTeamNames[0], starters: [`${testTeamNames[0]} Player 1`] },
      right: { name: testTeamNames[1], starters: [`${testTeamNames[1]} Player 1`] },
    });

    await fetch(`${baseUrl}/api/v1/sessions/${session.sessionId}/final`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [sessionTokenHeader]: session.token },
      body: JSON.stringify(normal),
    });

    const submitted = submissions[0].qbj as any;
    expect(submitted.tossups_read).toBe(20);
    expect(submitted.match_questions).toHaveLength(20);
  });
});

describe('serving the room application', () => {
  test('the root path serves index.html', async () => {
    const res = await fetch(`${baseUrl}/`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('Room');
  });

  test('bundle assets are served with the right content type', async () => {
    const res = await fetch(`${baseUrl}/room.js`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/javascript');
  });

  test('an unknown path falls back to index.html rather than leaking a 404 page', async () => {
    const res = await fetch(`${baseUrl}/some/room/route`);

    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Room');
  });

  test('path traversal cannot escape the bundle directory', async () => {
    const outside = path.join(bundleDir, '..', 'yf-secret-probe.txt');
    writeFileSync(outside, 'TOP SECRET');
    try {
      // Sent over raw sockets on purpose: fetch() normalizes ".." away client-side, so going through
      // it would test URL parsing rather than the server's containment check.
      const responses = await Promise.all(
        [
          '/../yf-secret-probe.txt',
          '/..%2Fyf-secret-probe.txt',
          '/%2e%2e%2fyf-secret-probe.txt',
          '/a/../../yf-secret-probe.txt',
          '/....//yf-secret-probe.txt',
        ].map((attempt) => rawRequest(`GET ${attempt} HTTP/1.1`)),
      );

      for (const response of responses) {
        expect(response).not.toContain('TOP SECRET');
      }
    } finally {
      rmSync(outside, { force: true });
    }
  });

  test('absolute filesystem paths are not served', async () => {
    const res = await fetch(`${baseUrl}//etc/passwd`);

    expect(await res.text()).not.toContain('root:');
  });

  test('writes to the static handler are refused', async () => {
    const res = await fetch(`${baseUrl}/index.html`, { method: 'POST' });

    expect(res.status).toBe(405);
  });
});
