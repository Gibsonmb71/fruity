import { describe, expect, test } from 'vitest';
import MatchImportService from '../renderer/Services/MatchImportService';
import { ScheduledMatch } from '../renderer/DataModel/ScheduledMatch';
import { TournamentRoom } from '../renderer/DataModel/TournamentRoom';
import buildPublicLiveSnapshot from '../renderer/Services/PublicLiveSnapshot';
import { makeModaqQbjMatch, makeStandardModaqMatch, makeTestTournament, testTeamNames } from './TestFixtures';
import { makeSlides, parseDisplayRoute } from '../live/LiveApp';

function enableLive(tournament: ReturnType<typeof makeTestTournament>) {
  tournament.liveDisplaySettings.enabled = true;
  return tournament;
}

function importAccepted(
  tournament: ReturnType<typeof makeTestTournament>,
  payload: Record<string, any>,
  roundNumber = 1,
) {
  const round = tournament.getRoundObjByNumber(roundNumber);
  if (!round) throw new Error(`Missing test round ${roundNumber}`);
  const result = new MatchImportService(tournament).importMatches(
    [{ filePath: `round-${roundNumber}.qbj`, fileContents: JSON.stringify(payload) }],
    round,
  ).results[0];
  if (!result?.match) throw new Error('The test match did not import');
  round.addMatch(result.match);
  return result.match;
}

function makeTiePayload(round = 1) {
  return makeModaqQbjMatch({
    round,
    tossupsRead: 20,
    left: {
      name: testTeamNames[0],
      bonusPoints: 100,
      players: [{ name: `${testTeamNames[0]} Player 1`, tossupsHeard: 20, buzzes: [[10, 5]] }],
    },
    right: {
      name: testTeamNames[1],
      bonusPoints: 100,
      players: [{ name: `${testTeamNames[1]} Player 1`, tossupsHeard: 20, buzzes: [[10, 5]] }],
    },
  });
}

describe('public live snapshot projection', () => {
  test('stays disabled until the director publishes Live Display', () => {
    const tournament = makeTestTournament();

    expect(buildPublicLiveSnapshot(tournament)).toBeNull();

    enableLive(tournament);
    expect(buildPublicLiveSnapshot(tournament)).not.toBeNull();
  });

  test('accepted results update standings, individual rankings, pools, and recent results', () => {
    const tournament = enableLive(makeTestTournament());
    importAccepted(tournament, makeStandardModaqMatch(1));

    const snapshot = buildPublicLiveSnapshot(tournament, new Date('2026-08-05T15:00:00.000Z'))!;
    const winner = snapshot.teamStandings.find((row) => row.teamName === testTeamNames[0]);
    const player = snapshot.individualStandings.find((row) => row.playerName.includes('Player 1'));
    const pool = snapshot.phaseStandings[0]?.pools[0];

    expect(winner).toMatchObject({ wins: 1, losses: 0, record: '1-0', totalPoints: 265 });
    expect(snapshot.latestCompletedRound).toEqual({ number: 1, name: 'Round 1' });
    expect(snapshot.recentResults[0]).toMatchObject({
      roundNumber: 1,
      leftTeam: testTeamNames[0],
      rightTeam: testTeamNames[1],
      leftScore: 265,
      rightScore: 155,
      result: 'left',
    });
    expect(player?.rank).toBeTruthy();
    expect(player?.tossupsHeard).toBeGreaterThan(0);
    expect(pool?.teams.map((row) => row.teamName)).toContain(testTeamNames[0]);
    expect(snapshot.lastUpdatedAt).toBe('2026-08-05T15:00:00.000Z');
  });

  test('an imported but unaccepted result does not change the public standings', () => {
    const tournament = enableLive(makeTestTournament());
    const round = tournament.getRoundObjByNumber(1)!;
    const result = new MatchImportService(tournament).importMatches(
      [{ filePath: 'submitted-but-unaccepted.qbj', fileContents: JSON.stringify(makeStandardModaqMatch(1)) }],
      round,
    ).results[0];

    expect(result.match).toBeDefined();
    const snapshot = buildPublicLiveSnapshot(tournament)!;
    const winner = snapshot.teamStandings.find((row) => row.teamName === testTeamNames[0]);

    expect(round.matches).toHaveLength(0);
    expect(winner).toMatchObject({ wins: 0, losses: 0, record: '0-0', totalPoints: 0 });
    expect(snapshot.recentResults).toEqual([]);
    expect(snapshot.individualStandings).toEqual([]);
    expect(snapshot.latestCompletedRound).toBeNull();
  });

  test('ties use YellowFruit tie records and tie rank strings', () => {
    const tournament = enableLive(makeTestTournament());
    importAccepted(tournament, makeTiePayload());

    const snapshot = buildPublicLiveSnapshot(tournament)!;
    const left = snapshot.teamStandings.find((row) => row.teamName === testTeamNames[0]);
    const right = snapshot.teamStandings.find((row) => row.teamName === testTeamNames[1]);

    expect(left).toMatchObject({ ties: 1, record: '0-0-1', rank: '1=' });
    expect(right).toMatchObject({ ties: 1, record: '0-0-1', rank: '1=' });
    expect(snapshot.recentResults[0]?.result).toBe('tie');
  });

  test('only the released round and its current room assignments are public', () => {
    const tournament = enableLive(makeTestTournament());
    const firstRoom = new TournamentRoom('Room 101', 0);
    const secondRoom = new TournamentRoom('Room 102', 1);
    tournament.rooms = [firstRoom, secondRoom];
    const roundTwo = new ScheduledMatch(2, testTeamNames[0], testTeamNames[1]);
    roundTwo.roomId = firstRoom.id;
    const unreleasedRound = new ScheduledMatch(3, testTeamNames[2], testTeamNames[3]);
    unreleasedRound.roomId = secondRoom.id;
    tournament.scheduledMatches = [roundTwo, unreleasedRound];

    expect(buildPublicLiveSnapshot(tournament)!.nextRound).toBeNull();

    tournament.releasedRoundNumber = 2;
    let snapshot = buildPublicLiveSnapshot(tournament)!;
    expect(snapshot.nextRound).toEqual({
      round: { number: 2, name: 'Round 2' },
      assignments: [{ leftTeam: testTeamNames[0], rightTeam: testTeamNames[1], roomName: 'Room 101' }],
    });
    expect(JSON.stringify(snapshot)).not.toContain(firstRoom.accessToken);
    expect(JSON.stringify(snapshot)).not.toContain(roundTwo.id);

    roundTwo.roomId = secondRoom.id;
    snapshot = buildPublicLiveSnapshot(tournament)!;
    expect(snapshot.nextRound?.assignments[0]?.roomName).toBe('Room 102');
  });
});

describe('display slideshow projection', () => {
  test('paginates long rankings and leaves each page at the configured size', () => {
    const tournament = enableLive(makeTestTournament());
    const snapshot = buildPublicLiveSnapshot(tournament)!;
    snapshot.settings.rowsPerSlide = 10;
    snapshot.settings.slides = {
      teamStandings: true,
      individuals: false,
      pools: false,
      recentResults: false,
      nextRound: false,
    };
    snapshot.teamStandings = Array.from({ length: 21 }, (_, index) => ({
      ...snapshot.teamStandings[0],
      rank: String(index + 1),
      teamName: `Team ${index + 1}`,
    }));

    const slides = makeSlides(snapshot, null);

    expect(slides).toHaveLength(3);
    expect(slides.map((slide) => slide.teams?.length)).toEqual([10, 10, 1]);
    expect(slides.map((slide) => `${slide.page}/${slide.pageCount}`)).toEqual(['1/3', '2/3', '3/3']);
  });

  test('fixed display URLs select one mode and only rotate when explicitly requested', () => {
    expect(parseDisplayRoute('?mode=standings')).toEqual({
      fixedMode: 'standings',
      explicitRotate: false,
      autoRotate: false,
    });
    expect(parseDisplayRoute('?mode=individuals&rotate=true')).toEqual({
      fixedMode: 'individuals',
      explicitRotate: true,
      autoRotate: true,
    });
    expect(parseDisplayRoute('')).toEqual({ fixedMode: null, explicitRotate: false, autoRotate: true });
  });
});
