import { afterEach, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import TournamentServer from '../main/server/TournamentServer';
import { IMatchSubmission, ITournamentSnapshot, SessionStatus, sessionTokenHeader } from '../main/server/ServerTypes';
import scoringRulesToModaqGameFormat from '../renderer/Services/YellowFruitScoringRulesToModaq';
import { CommonRuleSets, ScoringRules } from '../renderer/DataModel/ScoringRules';
import { ScheduledMatchStatus } from '../renderer/DataModel/ScheduledMatch';
import { makeStandardModaqMatch, testTeamNames } from './TestFixtures';

function snapshot(
  recoveryKey = 'recovery-test',
  overrides: Partial<Pick<ITournamentSnapshot, 'assignments'>> = {},
): ITournamentSnapshot {
  const format = scoringRulesToModaqGameFormat(new ScoringRules(CommonRuleSets.AcfPowers));
  return {
    name: 'Recovery Tournament',
    rounds: [{ number: 1, name: '1' }],
    teams: testTeamNames.map((name) => ({ name, players: [{ name: `${name} Player` }] })),
    gameFormat: format.ok ? format.gameFormat : null,
    gameFormatErrors: format.ok ? [] : format.errors,
    gameFormatWarnings: format.ok ? format.warnings : [],
    timedRounds: false,
    roomScoringMode: 'browser',
    rooms: [],
    assignments: overrides.assignments ?? [],
    currentRoundNumber: 1,
    releasedRoundNumber: 1,
    recoveryKey,
  };
}

const bundleDirectories: string[] = [];
const recoveryDirectories: string[] = [];
const servers: TournamentServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
  for (const directory of bundleDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
  for (const directory of recoveryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function makeServer(recoveryFilePath: string, submissions: IMatchSubmission[]) {
  const bundleDirectory = mkdtempSync(path.join(tmpdir(), 'yf-recovery-room-'));
  bundleDirectories.push(bundleDirectory);
  writeFileSync(path.join(bundleDirectory, 'index.html'), '<!doctype html><title>Room</title>');
  const server = new TournamentServer({
    roomBundleDirectory: bundleDirectory,
    recoveryFilePath,
    onFinalSubmission: (submission) => submissions.push(submission),
  });
  servers.push(server);
  return server;
}

describe('Tournament Server recovery store', () => {
  test('pending final and session linkage survive a server restart', async () => {
    const recoveryDirectory = mkdtempSync(path.join(tmpdir(), 'yf-recovery-data-'));
    recoveryDirectories.push(recoveryDirectory);
    const recoveryFilePath = path.join(recoveryDirectory, 'recovery.json');
    const firstSubmissions: IMatchSubmission[] = [];
    const first = makeServer(recoveryFilePath, firstSubmissions);
    first.setTournamentSnapshot(snapshot());
    await first.start(0);
    const firstPort = (first as any).server.address().port;

    const created = await fetch(`http://127.0.0.1:${firstPort}/api/v1/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roundNumber: 1, leftTeam: testTeamNames[0], rightTeam: testTeamNames[1] }),
    });
    const session = await created.json();
    const final = await fetch(`http://127.0.0.1:${firstPort}/api/v1/sessions/${session.sessionId}/final`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [sessionTokenHeader]: session.token },
      body: JSON.stringify(makeStandardModaqMatch()),
    });
    expect(final.status).toBe(200);
    expect(firstSubmissions).toHaveLength(1);

    await first.stop();

    const secondSubmissions: IMatchSubmission[] = [];
    const second = makeServer(recoveryFilePath, secondSubmissions);
    second.setTournamentSnapshot(snapshot());
    const pending = second.getPendingSubmissions();

    expect(pending).toHaveLength(1);
    expect(pending[0].sessionId).toBe(session.sessionId);
    expect(pending[0].qbj).toEqual(makeStandardModaqMatch());
    expect(second.sessions.get(session.sessionId)?.status).toBe(SessionStatus.Submitted);

    await second.start(0);
    const retry = await fetch(
      `http://127.0.0.1:${(second as any).server.address().port}/api/v1/sessions/${session.sessionId}/final`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [sessionTokenHeader]: session.token },
        body: JSON.stringify(makeStandardModaqMatch()),
      },
    );
    expect(retry.status).toBe(200);
    expect((await retry.json()).newSubmission).toBe(false);
    expect(secondSubmissions).toHaveLength(0);
  });

  test('a different tournament identity clears old transient state', async () => {
    const recoveryDirectory = mkdtempSync(path.join(tmpdir(), 'yf-recovery-key-'));
    recoveryDirectories.push(recoveryDirectory);
    const recoveryFilePath = path.join(recoveryDirectory, 'recovery.json');
    const first = makeServer(recoveryFilePath, []);
    first.setTournamentSnapshot(snapshot('tournament-a'));
    first.sessions.create(1, testTeamNames[0], testTeamNames[1]);
    await first.stop();

    const second = makeServer(recoveryFilePath, []);
    second.setTournamentSnapshot(snapshot('tournament-b'));

    expect(second.sessions.getAll()).toHaveLength(0);
    expect(second.getPendingSubmissions()).toHaveLength(0);
  });

  test('an Accepted recovery session is re-offered when the durable assignment is missing', async () => {
    const recoveryDirectory = mkdtempSync(path.join(tmpdir(), 'yf-recovery-accepted-'));
    recoveryDirectories.push(recoveryDirectory);
    const recoveryFilePath = path.join(recoveryDirectory, 'recovery.json');
    const first = makeServer(recoveryFilePath, []);
    first.setTournamentSnapshot(snapshot());
    const session = first.sessions.create(1, testTeamNames[0], testTeamNames[1]);
    first.sessions.submitFinal(session.id, session.token, makeStandardModaqMatch());
    first.acceptSession(session.id);
    await first.stop();

    const second = makeServer(recoveryFilePath, []);
    second.setTournamentSnapshot(snapshot());
    const pending = second.getPendingSubmissions();

    expect(pending).toHaveLength(1);
    expect(pending[0].sessionId).toBe(session.id);
    expect(second.sessions.get(session.id)?.status).toBe(SessionStatus.Submitted);
  });

  test('a durable accepted assignment reconciles a Submitted recovery session without reoffering it', async () => {
    const recoveryDirectory = mkdtempSync(path.join(tmpdir(), 'yf-recovery-durable-'));
    recoveryDirectories.push(recoveryDirectory);
    const recoveryFilePath = path.join(recoveryDirectory, 'recovery.json');
    const first = makeServer(recoveryFilePath, []);
    first.setTournamentSnapshot(snapshot());
    const session = first.sessions.create(1, testTeamNames[0], testTeamNames[1], {
      scheduledMatchId: 'scheduled-result',
      roomId: 'room-101',
    });
    first.sessions.submitFinal(session.id, session.token, makeStandardModaqMatch());
    await first.stop();

    const acceptedAssignment = {
      scheduledMatchId: 'scheduled-result',
      roomId: 'room-101',
      roundNumber: 1,
      roundName: '1',
      leftTeam: testTeamNames[0],
      rightTeam: testTeamNames[1],
      status: ScheduledMatchStatus.Accepted,
      resultMatchId: 'Match_1',
    };
    const second = makeServer(recoveryFilePath, []);
    second.setTournamentSnapshot(snapshot('recovery-test', { assignments: [acceptedAssignment] }));

    expect(second.getPendingSubmissions()).toHaveLength(0);
    expect(second.sessions.get(session.id)?.status).toBe(SessionStatus.Accepted);
  });
});
