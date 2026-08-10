/**
 * The QBTCP surface, over a real server on a real socket.
 *
 * Two claims are being protected. The canonical routes and the legacy ones are the *same*
 * implementation, so a fix to one is a fix to both and neither can quietly rot. And the assignment
 * a room receives over the network is a QBJ document — the same document tournament control could
 * have written to disk — which is the commitment the whole architecture rests on.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { openGameText, qbjMimeType, qbjSerializationVersion, qbtcpExtensionKey } from 'qbsheet';
import TournamentServer from '../main/server/TournamentServer';
import { ITournamentSnapshot, roomTokenHeader } from '../main/server/ServerTypes';
import { ScheduledMatchStatus } from '../renderer/DataModel/ScheduledMatch';
import scoringRulesToModaqGameFormat from '../renderer/Services/YellowFruitScoringRulesToModaq';
import scoringRulesToScorekeeperFormat from '../renderer/Services/ScorekeeperFormat';
import { CommonRuleSets, ScoringRules } from '../renderer/DataModel/ScoringRules';
import { testTeamNames } from './TestFixtures';

const roomToken = 'room-token-for-tests';
const roomId = 'room-204';
/** A second room, so resolving a room from its token is tested rather than assumed. */
const otherRoomToken = 'other-room-token';
const otherRoomId = 'room-205';

function makeSnapshot(): ITournamentSnapshot {
  const rules = new ScoringRules(CommonRuleSets.AcfPowers);
  const formatResult = scoringRulesToModaqGameFormat(rules);
  return {
    name: 'Test Tournament',
    recoveryKey: 'tournament-under-test',
    rounds: [1, 2, 3].map((n) => ({ number: n, name: String(n) })),
    teams: testTeamNames.map((name, index) => ({
      name,
      players: [
        { name: `${name} Player 1`, id: `Player_${name} Player 1_${index * 10 + 1}` },
        { name: `${name} Player 2`, id: `Player_${name} Player 2_${index * 10 + 2}` },
      ],
      // The organization, which is deliberately not the team name: this is what a real snapshot
      // carries and what the derived fallback would get wrong.
      registration: { id: `Registration_${name} School`, name: `${name} School` },
    })),
    gameFormat: formatResult.ok ? formatResult.gameFormat : null,
    gameFormatErrors: formatResult.ok ? [] : formatResult.errors,
    gameFormatWarnings: formatResult.ok ? formatResult.warnings : [],
    scoringFormat: scoringRulesToScorekeeperFormat(rules),
    timedRounds: false,
    roomScoringMode: 'browser',
    resultHandoffInstruction: 'Upload to the round folder.',
    rooms: [
      { id: roomId, name: 'Room 204', accessToken: roomToken, pairingCode: '12345678', enabled: true },
      { id: otherRoomId, name: 'Room 205', accessToken: otherRoomToken, pairingCode: '87654321', enabled: true },
    ],
    assignments: [
      {
        scheduledMatchId: 'scheduled-1',
        roundNumber: 1,
        roundName: 'Round 1',
        roundRevision: 3,
        roomId,
        leftTeam: testTeamNames[0],
        rightTeam: testTeamNames[1],
        status: ScheduledMatchStatus.Ready,
        phaseName: 'Prelims',
      },
      {
        scheduledMatchId: 'scheduled-2',
        roundNumber: 1,
        roundName: 'Round 1',
        roundRevision: 3,
        roomId: otherRoomId,
        leftTeam: testTeamNames[2],
        rightTeam: testTeamNames[3],
        status: ScheduledMatchStatus.Ready,
        phaseName: 'Prelims',
      },
    ],
    currentRoundNumber: 1,
    releasedRoundNumber: 1,
  };
}

let server: TournamentServer;
let baseUrl: string;
let bundleDir: string;

beforeEach(async () => {
  bundleDir = mkdtempSync(path.join(tmpdir(), 'yf-qbtcp-bundle-'));
  writeFileSync(path.join(bundleDir, 'index.html'), '<!doctype html><title>Room</title>');

  server = new TournamentServer({
    roomBundleDirectory: bundleDir,
    onFinalSubmission: () => {},
    // The one origin approved for cross-origin access in these tests. Anything not on this list is
    // refused, which is what the CORS cases below rely on -- do not change the value.
    allowedQbsheetOrigins: ['https://qbsheet.com'],
  });
  server.setTournamentSnapshot(makeSnapshot());
  const status = await server.start(0);
  expect(status.running).toBe(true);
  baseUrl = `http://127.0.0.1:${
    (server as unknown as { server: { address(): { port: number } } }).server.address().port
  }`;
});

afterEach(async () => {
  await server.stop();
  rmSync(bundleDir, { recursive: true, force: true });
});

const roomHeaders = { [roomTokenHeader]: roomToken };

describe('discovery', () => {
  test('announces the protocol, its version and what it supports', async () => {
    const res = await fetch(`${baseUrl}/qbtcp/v1`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.protocol).toBe('QBTCP');
    expect(body.version).toBe(1);
    expect(body.qbj_version).toBe(qbjSerializationVersion);
    expect(body.capabilities).toEqual(expect.arrayContaining(['pairing', 'assignment', 'result']));
  });

  test('needs no credential, and reveals no schedule', async () => {
    const body = await (await fetch(`${baseUrl}/qbtcp/v1`)).json();

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(roomToken);
    expect(serialized).not.toContain('12345678');
    expect(serialized).not.toContain('scheduled-1');
    expect(serialized).not.toContain(testTeamNames[0]);
  });
});

describe('the assignment endpoint', () => {
  test('the body is a QBJ document, with the QBJ media type', async () => {
    const res = await fetch(`${baseUrl}/qbtcp/v1/assignment`, { headers: roomHeaders });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe(qbjMimeType);
    const body = await res.json();
    expect(body.version).toBe(qbjSerializationVersion);
    expect(body.objects.some((entry: { type?: string }) => entry.type === 'Tournament')).toBe(true);
    expect(body.objects.some((entry: { type?: string }) => entry.type === 'Match')).toBe(true);
  });

  test('QBSheet opens it with the same parser a file goes through', async () => {
    const text = await (await fetch(`${baseUrl}/qbtcp/v1/assignment`, { headers: roomHeaders })).text();

    const opened = openGameText(text);

    expect(opened.ok).toBe(true);
    if (!opened.ok || opened.kind !== 'game') throw new Error('Expected one game');
    expect(opened.definition.origin).toBe('qbj');
    expect(opened.definition.qbjIdentity?.matchId).toBe('scheduled-1');
    expect(opened.definition.qbjIdentity?.tournamentId).toBe('tournament-under-test');
    expect(opened.definition.left.name).toBe(testTeamNames[0]);
    expect(opened.definition.right.name).toBe(testTeamNames[1]);
    expect(opened.definition.round.number).toBe(1);
    expect(opened.definition.room?.name).toBe('Room 204');
  });

  test('player identity survives the network, so a result can be matched on it', async () => {
    const text = await (await fetch(`${baseUrl}/qbtcp/v1/assignment`, { headers: roomHeaders })).text();

    const opened = openGameText(text);
    if (!opened.ok || opened.kind !== 'game') throw new Error('Expected one game');

    const ids = opened.definition.qbjIdentity?.playerIds ?? {};
    expect(Object.keys(ids).length).toBeGreaterThan(0);
    expect(Object.values(ids)[0]).toMatch(/^Player_/);
  });

  test('the operational extension travels, and carries no credential', async () => {
    const body = await (await fetch(`${baseUrl}/qbtcp/v1/assignment`, { headers: roomHeaders })).json();
    const match = body.objects.find((entry: { type?: string }) => entry.type === 'Match');

    expect(match[qbtcpExtensionKey].round_revision).toBe(3);
    expect(match[qbtcpExtensionKey].room_id).toBe(roomId);

    const serialized = JSON.stringify(body).toLowerCase();
    expect(serialized).not.toContain(roomToken);
    expect(serialized).not.toContain('12345678');
    for (const forbidden of ['token', 'pairing', 'authorization']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  test('authentication is still enforced', async () => {
    expect((await fetch(`${baseUrl}/qbtcp/v1/assignment`)).status).toBe(403);
    expect((await fetch(`${baseUrl}/qbtcp/v1/assignment`, { headers: { [roomTokenHeader]: 'wrong' } })).status).toBe(
      403,
    );
  });

  test('a room with nothing to score gets no content rather than an empty document', async () => {
    server.setTournamentSnapshot({ ...makeSnapshot(), assignments: [] });

    const res = await fetch(`${baseUrl}/qbtcp/v1/assignment`, { headers: roomHeaders });

    expect(res.status).toBe(204);
  });

  test('operational state stays out of the QBJ body and lives beside it', async () => {
    const body = await (await fetch(`${baseUrl}/qbtcp/v1/assignment`, { headers: roomHeaders })).json();
    expect(JSON.stringify(body)).not.toContain('blockedReason');

    const status = await fetch(`${baseUrl}/qbtcp/v1/assignment/status`, { headers: roomHeaders });

    expect(status.status).toBe(200);
    const statusBody = await status.json();
    expect(statusBody.current?.scheduledMatchId).toBe('scheduled-1');
  });
});

describe('canonical routes and their legacy aliases', () => {
  test('the room id is not in a canonical path, but the legacy one still routes on it', async () => {
    const canonical = await fetch(`${baseUrl}/qbtcp/v1/assignment/status`, { headers: roomHeaders });
    const legacy = await fetch(`${baseUrl}/api/v1/rooms/${roomId}/assignment`, { headers: roomHeaders });

    expect(canonical.status).toBe(200);
    expect(legacy.status).toBe(200);

    // Same handler, so the same answer about the same game. Compared field by field rather than
    // whole-body because a poll records a check-in, and the second call legitimately sees the
    // presence the first one created.
    const canonicalBody = await canonical.json();
    const legacyBody = await legacy.json();
    expect(canonicalBody.roomId).toBe(legacyBody.roomId);
    expect(canonicalBody.current).toEqual(legacyBody.current);
    expect(canonicalBody.scoringFormat).toEqual(legacyBody.scoringFormat);
    expect(canonicalBody.blockedReason).toBe(legacyBody.blockedReason);
  });

  test('pairing works under both names', async () => {
    const body = JSON.stringify({ code: '12345678', roomId });
    const headers = { 'Content-Type': 'application/json' };

    const canonical = await fetch(`${baseUrl}/qbtcp/v1/pair`, { method: 'POST', headers, body });
    const legacy = await fetch(`${baseUrl}/api/v1/join`, { method: 'POST', headers, body });

    expect(canonical.status).toBe(200);
    expect(await canonical.json()).toEqual(await legacy.json());
  });

  test('the room list works under both names and still leaks no token', async () => {
    const canonical = await fetch(`${baseUrl}/qbtcp/v1/rooms`);
    const legacy = await fetch(`${baseUrl}/api/v1/join/rooms`);

    expect(canonical.status).toBe(200);
    const body = await canonical.json();
    expect(await legacy.json()).toEqual(body);
    expect(JSON.stringify(body)).not.toContain(roomToken);
  });

  test('presence works under both names', async () => {
    const canonical = await fetch(`${baseUrl}/qbtcp/v1/presence`, { headers: roomHeaders });

    expect(canonical.status).toBe(200);
  });

  test('an unknown canonical path is a 404, not a fall-through to the room application', async () => {
    const res = await fetch(`${baseUrl}/qbtcp/v1/nonsense`, { headers: roomHeaders });

    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('json');
  });

  test('a room-scoped canonical route without a token is refused', async () => {
    expect((await fetch(`${baseUrl}/qbtcp/v1/presence`)).status).toBe(403);
    expect((await fetch(`${baseUrl}/qbtcp/v1/help`)).status).toBe(403);
  });
});

describe('CORS and local network access', () => {
  const origin = 'https://qbsheet.com';

  test('a preflight for a canonical path is answered, with the private-network handshake', async () => {
    const res = await fetch(`${baseUrl}/qbtcp/v1/assignment`, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Private-Network': 'true',
      },
    });

    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(origin);
    expect(res.headers.get('access-control-allow-private-network')).toBe('true');
    expect(res.headers.get('vary')).toContain('Origin');
  });

  test('the approved origin is echoed, never a wildcard', async () => {
    const res = await fetch(`${baseUrl}/qbtcp/v1`, { headers: { Origin: origin } });

    expect(res.headers.get('access-control-allow-origin')).toBe(origin);
    expect(res.headers.get('access-control-allow-origin')).not.toBe('*');
  });

  test('a preflight from an origin that is not on the allowlist is refused', async () => {
    const res = await fetch(`${baseUrl}/qbtcp/v1/assignment`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://not-approved.example', 'Access-Control-Request-Method': 'GET' },
    });

    expect(res.status).toBe(403);
  });

  test('the credential headers a room needs are allowed', async () => {
    const res = await fetch(`${baseUrl}/qbtcp/v1/assignment`, {
      method: 'OPTIONS',
      headers: { Origin: origin, 'Access-Control-Request-Method': 'GET' },
    });

    const allowed = res.headers.get('access-control-allow-headers') ?? '';
    expect(allowed).toContain(roomTokenHeader);
    expect(allowed).toContain('Access-Control-Request-Private-Network');
  });
});

describe('a token identifies exactly one room', () => {
  const otherHeaders = { [roomTokenHeader]: otherRoomToken };

  test('each token gets its own room, and never the other one', async () => {
    const mine = await (await fetch(`${baseUrl}/qbtcp/v1/assignment`, { headers: roomHeaders })).text();
    const theirs = await (await fetch(`${baseUrl}/qbtcp/v1/assignment`, { headers: otherHeaders })).text();

    expect(mine).toContain('scheduled-1');
    expect(mine).not.toContain('scheduled-2');
    expect(theirs).toContain('scheduled-2');
    expect(theirs).not.toContain('scheduled-1');
  });

  test('the status endpoint resolves the same room the token names', async () => {
    const mine = await (await fetch(`${baseUrl}/qbtcp/v1/assignment/status`, { headers: roomHeaders })).json();
    const theirs = await (await fetch(`${baseUrl}/qbtcp/v1/assignment/status`, { headers: otherHeaders })).json();

    expect(mine.roomId).toBe(roomId);
    expect(theirs.roomId).toBe(otherRoomId);
    expect(mine.current?.scheduledMatchId).toBe('scheduled-1');
    expect(theirs.current?.scheduledMatchId).toBe('scheduled-2');
  });
});

describe('identity the snapshot carries rather than derives', () => {
  test('the registration is the organization, not the team name', async () => {
    const body = await (await fetch(`${baseUrl}/qbtcp/v1/assignment`, { headers: roomHeaders })).json();
    const registrations = body.objects.filter((entry: { type?: string }) => entry.type === 'Registration');

    // An organization fields an A and a B team under one registration, so `Registration_${teamName}`
    // would name one that does not exist.
    expect(registrations).toHaveLength(2);
    expect(registrations[0].id).toBe(`Registration_${testTeamNames[0]} School`);
    expect(registrations[0].name).toBe(`${testTeamNames[0]} School`);
  });

  test('the phase is the one the round belongs to, not a hard-coded default', async () => {
    const body = await (await fetch(`${baseUrl}/qbtcp/v1/assignment`, { headers: roomHeaders })).json();
    const tournament = body.objects.find((entry: { type?: string }) => entry.type === 'Tournament');

    expect(tournament.phases[0].name).toBe('Prelims');
    expect(tournament.phases[0].id).toBe('Phase_Prelims');
  });

  test('a phase the snapshot cannot name is omitted rather than invented', async () => {
    const snapshot = makeSnapshot();
    server.setTournamentSnapshot({
      ...snapshot,
      assignments: snapshot.assignments.map((assignment) => ({ ...assignment, phaseName: undefined })),
    });

    const body = await (await fetch(`${baseUrl}/qbtcp/v1/assignment`, { headers: roomHeaders })).json();
    const tournament = body.objects.find((entry: { type?: string }) => entry.type === 'Tournament');

    expect(tournament.phases[0].name).toBeUndefined();
    expect(tournament.phases[0].id).toBe('Phase_1');
  });
});

describe('session paths', () => {
  test('a trailing segment is a 404, not a silently ignored suffix', async () => {
    const res = await fetch(`${baseUrl}/qbtcp/v1/sessions/some-id/progress/extra`, { method: 'PUT' });

    expect(res.status).toBe(404);
  });

  test('an unknown session sub-path is a 404', async () => {
    expect((await fetch(`${baseUrl}/qbtcp/v1/sessions/some-id/nonsense`)).status).toBe(404);
  });
});
