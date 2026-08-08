import { afterEach, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import TournamentServer from '../main/server/TournamentServer';
import { ITournamentSnapshot } from '../main/server/ServerTypes';
import { IPublicLiveSnapshot, IPublicPairingsSnapshot } from '../shared/LiveTypes';
import scoringRulesToModaqGameFormat from '../renderer/Services/YellowFruitScoringRulesToModaq';
import scoringRulesToScorekeeperFormat from '../renderer/Services/ScorekeeperFormat';
import { CommonRuleSets, ScoringRules } from '../renderer/DataModel/ScoringRules';
import { testTeamNames } from './TestFixtures';

const rules = new ScoringRules(CommonRuleSets.AcfPowers);
const format = scoringRulesToModaqGameFormat(rules);

/** The projection of a tournament that has been set up: teams, a room, and a game to play in it. */
function loadedSnapshot(recoveryKey: string): ITournamentSnapshot {
  return {
    name: 'Saturday Invitational',
    rounds: [{ number: 1, name: '1' }],
    teams: testTeamNames.map((name) => ({ name, players: [{ name: `${name} Player` }] })),
    gameFormat: format.ok ? format.gameFormat : null,
    gameFormatErrors: format.ok ? [] : format.errors,
    gameFormatWarnings: format.ok ? format.warnings : [],
    scoringFormat: scoringRulesToScorekeeperFormat(rules),
    timedRounds: false,
    roomScoringMode: 'browser',
    rooms: [{ id: 'room-101', name: '101', accessToken: 'token-101', enabled: true }],
    assignments: [],
    currentRoundNumber: 1,
    releasedRoundNumber: 1,
    recoveryKey,
  };
}

/**
 * What a freshly constructed renderer pushes: `new Tournament()` with its own random operational
 * id, before anyone has opened a file.
 */
function blankSnapshot(recoveryKey: string): ITournamentSnapshot {
  return {
    name: 'Untitled tournament',
    rounds: [],
    teams: [],
    gameFormat: null,
    gameFormatErrors: [],
    gameFormatWarnings: [],
    scoringFormat: scoringRulesToScorekeeperFormat(new ScoringRules(CommonRuleSets.AcfPowers)),
    timedRounds: false,
    rooms: [],
    assignments: [],
    currentRoundNumber: null,
    recoveryKey,
  };
}

const publicLive = { updatedAt: '2026-08-08T12:00:00.000Z' } as unknown as IPublicLiveSnapshot;
const publicPairings = { updatedAt: '2026-08-08T12:00:00.000Z' } as unknown as IPublicPairingsSnapshot;

const temporaryDirectories: string[] = [];
const servers: TournamentServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function makeServer() {
  const bundleDirectory = mkdtempSync(path.join(tmpdir(), 'yf-snapshot-guard-room-'));
  const recoveryDirectory = mkdtempSync(path.join(tmpdir(), 'yf-snapshot-guard-data-'));
  temporaryDirectories.push(bundleDirectory, recoveryDirectory);
  writeFileSync(path.join(bundleDirectory, 'index.html'), '<!doctype html><title>Room</title>');
  const server = new TournamentServer({
    roomBundleDirectory: bundleDirectory,
    recoveryFilePath: path.join(recoveryDirectory, 'recovery.json'),
    onFinalSubmission: () => {},
  });
  servers.push(server);
  return server;
}

describe('Tournament Server snapshot identity guard', () => {
  test('a renderer restarting on a blank tournament cannot wipe the running server', async () => {
    const server = makeServer();
    server.setTournamentSnapshot(loadedSnapshot('tournament-a'));
    server.setPublicLiveSnapshot(publicLive);
    server.setPublicPairingsSnapshot(publicPairings);
    await server.start(0);
    const session = server.sessions.create(1, testTeamNames[0], testTeamNames[1], {
      roomId: 'room-101',
      tournamentKey: 'tournament-a',
    });

    // The renderer reloads and immediately pushes its brand-new empty tournament.
    server.setTournamentSnapshot(blankSnapshot('tournament-reloaded'));
    server.setPublicLiveSnapshot(null);
    server.setPublicPairingsSnapshot(null);

    expect(server.isRunning()).toBe(true);
    expect(server.getTournamentSnapshot().name).toBe('Saturday Invitational');
    expect(server.getTournamentSnapshot().rooms).toHaveLength(1);
    expect(server.getStatus().tournamentKey).toBe('tournament-a');
    expect(server.sessions.get(session.id)).toBeDefined();
    expect(server.getPublicLiveSnapshot()).toBe(publicLive);
    expect(server.getPublicPairingsSnapshot()).toBe(publicPairings);
  });

  test('reopening the same tournament after a renderer restart is accepted normally', async () => {
    const server = makeServer();
    server.setTournamentSnapshot(loadedSnapshot('tournament-a'));
    await server.start(0);
    const session = server.sessions.create(1, testTeamNames[0], testTeamNames[1], {
      roomId: 'room-101',
      tournamentKey: 'tournament-a',
    });

    server.setTournamentSnapshot(blankSnapshot('tournament-reloaded'));
    server.setTournamentSnapshot(loadedSnapshot('tournament-a'));
    server.setPublicLiveSnapshot(publicLive);

    expect(server.sessions.get(session.id)).toBeDefined();
    expect(server.getPublicLiveSnapshot()).toBe(publicLive);
  });

  test('a real switch to another set-up tournament still clears the previous one', async () => {
    const server = makeServer();
    server.setTournamentSnapshot(loadedSnapshot('tournament-a'));
    await server.start(0);
    server.sessions.create(1, testTeamNames[0], testTeamNames[1], { tournamentKey: 'tournament-a' });

    server.setTournamentSnapshot(loadedSnapshot('tournament-b'));

    expect(server.sessions.getAll()).toHaveLength(0);
    expect(server.getStatus().tournamentKey).toBe('tournament-b');
  });

  test('a stopped server with no sessions still adopts a new blank tournament', () => {
    const server = makeServer();
    server.setTournamentSnapshot(loadedSnapshot('tournament-a'));

    server.setTournamentSnapshot(blankSnapshot('tournament-new'));

    expect(server.getTournamentSnapshot().rooms).toHaveLength(0);
    expect(server.getStatus().tournamentKey).toBe('tournament-new');
  });
});
