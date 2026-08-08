import { expect, test } from 'vitest';
import dayjs from 'dayjs';
import { TournamentManager } from '../renderer/TournamentManager';
import { NullDate } from '../renderer/Utils/UtilTypes';
import { makeTestTournament, testTeamNames } from './TestFixtures';
import { Team } from '../renderer/DataModel/Team';
import { Player } from '../renderer/DataModel/Player';

class TestTournamentManager extends TournamentManager {
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

// #region setTournamentName
// basic test
test('setTournamentName01', () => {
  const mgr = new TestTournamentManager();
  const expected = 'abc';
  mgr.setTournamentName(expected);
  expect(mgr.tournament.name).toBe(expected);
});

// unsaved data flag
test('setTournamentName02', () => {
  const mgr = new TestTournamentManager();
  expect(mgr.unsavedData).toBeFalsy();

  mgr.setTournamentName('abc');
  expect(mgr.unsavedData).toBeTruthy();

  mgr.unsavedData = false;
  mgr.setTournamentName('abc');
  expect(mgr.unsavedData).toBeFalsy();
});

// trim whitspace
test('setTournamentName03', () => {
  const mgr = new TestTournamentManager();
  mgr.setTournamentName(' abc ');
  expect(mgr.tournament.name).toBe('abc');
});
// #endregion

test('setTournamentSiteName01', () => {
  const mgr = new TestTournamentManager();
  expect(mgr.unsavedData).toBeFalsy();

  mgr.setTournamentSiteName(' abc ');
  expect(mgr.tournament.tournamentSite.name).toBe('abc');
  expect(mgr.unsavedData).toBeTruthy();

  mgr.unsavedData = false;
  mgr.setTournamentSiteName(' abc ');
  expect(mgr.unsavedData).toBeFalsy();
});

test('setQuestionSetname01', () => {
  const mgr = new TestTournamentManager();
  expect(mgr.unsavedData).toBeFalsy();

  mgr.setQuestionSetname(' abc ');
  expect(mgr.tournament.questionSet).toBe('abc');
  expect(mgr.unsavedData).toBeTruthy();

  mgr.unsavedData = false;
  mgr.setQuestionSetname(' abc ');
  expect(mgr.unsavedData).toBeFalsy();
});

test('setTournamentStartDate', () => {
  const mgr = new TestTournamentManager();
  expect(mgr.unsavedData).toBeFalsy();

  mgr.setTournamentStartDate(dayjs('2023-10-15'));
  expect(mgr.tournament.startDate?.toString()).toBe(dayjs('2023-10-15').toDate().toString());
  expect(mgr.unsavedData).toBeTruthy();

  mgr.unsavedData = false;
  mgr.setTournamentStartDate(dayjs('2023-10-15'));
  expect(mgr.unsavedData).toBeFalsy();

  mgr.setTournamentStartDate(null);
  expect(NullDate.isNullDate(mgr.tournament.startDate)).toBeTruthy();
  expect(mgr.unsavedData).toBeTruthy();
});

test('a room-added player appends once, preserves player identity, and marks the tournament dirty', () => {
  const mgr = new TestTournamentManager();
  const tournament = makeTestTournament();
  mgr.tournament = tournament;
  mgr.tournamentServerService.setTournament(tournament);
  const team = tournament.getListOfAllTeams().find((candidate) => candidate.name === testTeamNames[0])!;
  const existing = team.players[0];

  expect(
    mgr.addPlayerFromRoom({
      roomId: 'room-1',
      sessionId: 'session-1',
      teamName: team.name,
      playerName: '  Taylor Brown  ',
      tournamentKey: tournament.operationalId,
    }),
  ).toEqual({ ok: true, added: true });
  expect(team.players.find((player) => player.name === 'Taylor Brown')).toBeInstanceOf(Player);
  expect(team.players[0]).toBe(existing);
  expect(mgr.unsavedData).toBe(true);
  expect(
    mgr.tournamentServerService
      .buildTournamentSnapshot()
      .teams.find((candidate) => candidate.name === team.name)
      ?.players.map((player) => player.name),
  ).toContain('Taylor Brown');

  expect(
    mgr.addPlayerFromRoom({
      roomId: 'room-1',
      sessionId: 'session-1',
      teamName: team.name,
      playerName: 'taylor brown',
    }),
  ).toEqual({ ok: true, added: false });
  expect(team.players.filter((player) => player.name.toLocaleLowerCase() === 'taylor brown')).toHaveLength(1);
});

test('room-added players are refused for wrong teams, invalid names, and full rosters', () => {
  const mgr = new TestTournamentManager();
  const tournament = makeTestTournament();
  mgr.tournament = tournament;
  mgr.tournamentServerService.setTournament(tournament);
  const team = tournament.getListOfAllTeams()[0];

  expect(
    mgr.addPlayerFromRoom({ roomId: 'room-1', sessionId: 'session-1', teamName: 'Not a team', playerName: 'Taylor' }),
  ).toMatchObject({ ok: false });
  expect(
    mgr.addPlayerFromRoom({ roomId: 'room-1', sessionId: 'session-1', teamName: team.name, playerName: '' }),
  ).toMatchObject({ ok: false });

  team.players = Array.from({ length: Team.maxPlayers }, (_, index) => new Player(`Player ${index + 1}`));
  expect(
    mgr.addPlayerFromRoom({ roomId: 'room-1', sessionId: 'session-1', teamName: team.name, playerName: 'Taylor' }),
  ).toMatchObject({ ok: false });
});
