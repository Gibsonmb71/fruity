from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one match, found {count}: {old[:80]!r}')
    file.write_text(text.replace(old, new, 1))


def replace_between(path: str, start: str, end: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    start_index = text.find(start)
    if start_index < 0:
        raise SystemExit(f'{path}: start marker not found: {start[:80]!r}')
    end_index = text.find(end, start_index)
    if end_index < 0:
        raise SystemExit(f'{path}: end marker not found: {end[:80]!r}')
    end_index += len(end)
    file.write_text(text[:start_index] + new + text[end_index:])


replace_once(
    'src/room/scorer/PlayersDialog.tsx',
    """  useEffect(() => {
    if (focusPlayerIndex.current === null) return;
    document.getElementById(playerInputId(focusPlayerIndex.current))?.focus();
    focusPlayerIndex.current = null;
  }, [selected]);""",
    """  useEffect(() => {
    if (focusPlayerIndex.current === null) return;
    document.getElementById(`scorer-lineup-${side}-${focusPlayerIndex.current}`)?.focus();
    focusPlayerIndex.current = null;
  }, [selected, side]);""",
)

replace_once(
    'src/room/scorer/OperationsDialogs.tsx',
    "const activeBuzzPlayers = event.type === 'tossup-buzz' ? question?.activePlayers[event.team] ?? [] : [];",
    "const activeBuzzPlayers = event.type === 'tossup-buzz' ? (question?.activePlayers[event.team] ?? []) : [];",
)
replace_once(
    'src/room/scorer/OperationsDialogs.tsx',
    """            {eventTeam.players.map((player) => {
              const checked = activePlayers.includes(player.name);""",
    """            {eventTeam.players.map((player, index) => {
              const checked = activePlayers.includes(player.name);
              const id = `event-lineup-${event.id}-${index}`;""",
)
replace_once(
    'src/room/scorer/OperationsDialogs.tsx',
    """                <label
                  key={player.name}
                  className="scorer-checkbox"
                  htmlFor={`event-lineup-${event.id}-${player.name}`}
                >
                  <input
                    id={`event-lineup-${event.id}-${player.name}`}""",
    """                <label key={player.name} className="scorer-checkbox" htmlFor={id}>
                  <input
                    id={id}""",
)

replace_once(
    'src/room/scorer/Scorer.tsx',
    "else if (connection === RoomConnectionState.Connected && onSyncRosterPlayer) status[key] = 'waiting';",
    """else if (authoritativeRosters && connection === RoomConnectionState.Connected && onSyncRosterPlayer)
        status[key] = 'waiting';""",
)
replace_between(
    'src/room/scorer/Scorer.tsx',
    """  useEffect(() => {
    if (connection !== RoomConnectionState.Connected || !onSyncRosterPlayer || !authoritativeRosters) return;
    const now = Date.now();""",
    """  }, [authoritativeRosters, connection, game.left.name, game.right.name, localRosterAdds, onSyncRosterPlayer]);""",
    """  useEffect(() => {
    if (connection !== RoomConnectionState.Connected || !onSyncRosterPlayer || !authoritativeRosters)
      return undefined;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const syncPending = () => {
      if (cancelled) return;
      const now = Date.now();
      let nextRetryAt: number | undefined;
      const scheduleRetry = (deadline: number) => {
        nextRetryAt = nextRetryAt === undefined ? deadline : Math.min(nextRetryAt, deadline);
      };

      for (const addition of localRosterAdds) {
        const authoritative = authoritativeRosters[addition.team];
        if (authoritative.some((name) => name.toLocaleLowerCase() === addition.playerName.toLocaleLowerCase()))
          continue;
        const key = rosterSyncKey(addition.team, addition.playerName);
        if (rejectedRosterSyncs[key]) continue;
        const previous = rosterSyncAttempts.current.get(key) ?? { attempts: 0, lastAt: 0 };
        const backoff = Math.min(30_000, 5_000 * 2 ** Math.min(previous.attempts, 3));
        const retryAt = previous.lastAt + backoff;
        if (now < retryAt) {
          scheduleRetry(retryAt);
          continue;
        }

        const attempts = previous.attempts + 1;
        rosterSyncAttempts.current.set(key, { attempts, lastAt: now });
        const nextBackoff = Math.min(30_000, 5_000 * 2 ** Math.min(attempts, 3));
        scheduleRetry(now + nextBackoff);
        const teamName = addition.team === 'left' ? game.left.name : game.right.name;
        onSyncRosterPlayer(teamName, addition.playerName)
          .then((result) => {
            if (!result.ok && result.rejected) {
              setRejectedRosterSyncs((current) => ({ ...current, [key]: true }));
            }
            return undefined;
          })
          .catch(() => undefined);
      }

      if (nextRetryAt !== undefined) {
        retryTimer = setTimeout(syncPending, Math.max(0, nextRetryAt - Date.now()));
      }
    };

    syncPending();
    return () => {
      cancelled = true;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
    };
  }, [
    authoritativeRosters,
    connection,
    game.left.name,
    game.right.name,
    localRosterAdds,
    onSyncRosterPlayer,
    rejectedRosterSyncs,
  ]);""",
)

replace_once(
    'src/room/scoring/deriveGame.ts',
    """  let upcomingBoundary = (questions.at(-1)?.questionNumber ?? 0) + 1;
  if (phase.kind === 'tossup') upcomingBoundary = phase.questionNumber;
  else if (phase.kind === 'bonus') upcomingBoundary = phase.questionNumber + 1;
  applyPersonnelThrough(upcomingBoundary);""",
    """  let upcomingBoundary = (questions.at(-1)?.questionNumber ?? 0) + 1;
  if (phase.kind === 'tossup') {
    const begun = events.some(
      (event) =>
        event.questionNumber === phase.questionNumber &&
        (event.type === 'tossup-buzz' || event.type === 'tossup-dead' || event.type === 'bonus'),
    );
    upcomingBoundary = begun ? phase.questionNumber + 1 : phase.questionNumber;
  } else if (phase.kind === 'bonus') upcomingBoundary = phase.questionNumber + 1;
  applyPersonnelThrough(upcomingBoundary);""",
)

replace_once(
    'src/room/ManualRoomApp.tsx',
    "import { readScorerChoice } from './ScorerChoice';",
    "import { readScorerChoice, type ScorerChoice } from './ScorerChoice';",
)
replace_once(
    'src/room/ManualRoomApp.tsx',
    """interface IEmergencyGameState {
  gameId: string;
  tournamentKey?: string;
  roundNumber: number;
  leftTeamName: string;
  rightTeamName: string;
}""",
    """interface IEmergencyGameState {
  gameId: string;
  tournamentKey?: string;
  roundNumber: number;
  leftTeamName: string;
  rightTeamName: string;
  scorer: ScorerChoice;
}""",
)
replace_once(
    'src/room/ManualRoomApp.tsx',
    """      leftTeamName: parsed.leftTeamName,
      rightTeamName: parsed.rightTeamName,
    };""",
    """      leftTeamName: parsed.leftTeamName,
      rightTeamName: parsed.rightTeamName,
      scorer: parsed.scorer === 'first-party' || parsed.scorer === 'legacy' ? parsed.scorer : 'legacy',
    };""",
)
replace_once(
    'src/room/ManualRoomApp.tsx',
    """  // Read once per mount; see AssignedRoomApp.
  const [scorerChoice] = useState(() => readScorerChoice());
  const [cachedKitUsable] = useState(() => isScoringKitUsable(cachedKit, new Date(), scorerChoice));""",
    """  const [scorerChoice, setScorerChoice] = useState(() => readScorerChoice());
  const cachedKitUsable = isScoringKitUsable(cachedKit, new Date(), scorerChoice);""",
)
replace_once(
    'src/room/ManualRoomApp.tsx',
    """            setEmergencyGameId(saved.gameId);
            setSetup({ round, leftTeam, rightTeam });""",
    """            setEmergencyGameId(saved.gameId);
            setScorerChoice(saved.scorer);
            setSetup({ round, leftTeam, rightTeam });""",
)
replace_once(
    'src/room/ManualRoomApp.tsx',
    """        leftTeamName: leftTeam.name,
        rightTeamName: rightTeam.name,
      });""",
    """        leftTeamName: leftTeam.name,
        rightTeamName: rightTeam.name,
        scorer: scorerChoice,
      });""",
)

replace_once(
    'src/main/server/Router.ts',
    "scorer: parseRequestedScorer(body.scorer, this.host.getSnapshot()),",
    """scorer:
          body.scorer === undefined ? undefined : parseRequestedScorer(body.scorer, this.host.getSnapshot()),""",
)
replace_once(
    'src/main/server/Router.ts',
    """    const readyRulesUsable =
      update.scorer === 'legacy'
        ? snapshot.gameFormat !== null
        : snapshot.scoringFormat !== null && scorekeeperFormatProblems(snapshot.scoringFormat).length === 0;
    if (update.ready === true && !readyRulesUsable) {
      sendError(res, 409, 'This browser cannot be marked ready until usable scoring rules are loaded.');
      return;
    }
    const deviceId = update.deviceId ?? headerToken(req, deviceIdHeader) ?? 'unidentified';
    this.host.onRoomCheckIn?.(
      roomId,
      deviceId,
      update.operatorName ?? headerToken(req, operatorNameHeader),
      readyRulesUsable ? update.ready : false,
    );""",
    """    const readyRulesUsable =
      update.scorer === undefined
        ? undefined
        : update.scorer === 'legacy'
          ? snapshot.gameFormat !== null
          : snapshot.scoringFormat !== null && scorekeeperFormatProblems(snapshot.scoringFormat).length === 0;
    if (update.ready === true && readyRulesUsable === false) {
      sendError(res, 409, 'This browser cannot be marked ready until usable scoring rules are loaded.');
      return;
    }
    const deviceId = update.deviceId ?? headerToken(req, deviceIdHeader) ?? 'unidentified';
    this.host.onRoomCheckIn?.(
      roomId,
      deviceId,
      update.operatorName ?? headerToken(req, operatorNameHeader),
      readyRulesUsable === undefined ? undefined : readyRulesUsable ? update.ready : false,
    );""",
)
replace_once(
    'src/main/server/Router.ts',
    """    const snapshot = this.host.getSnapshot();
    this.host.onRoomCheckIn?.(
      roomId,
      headerToken(req, deviceIdHeader),
      headerToken(req, operatorNameHeader),
      snapshot.scoringFormat === null || scorekeeperFormatProblems(snapshot.scoringFormat).length > 0
        ? false
        : undefined,
    );
    const response = buildAssignmentResponse(snapshot, room);""",
    """    const snapshot = this.host.getSnapshot();
    this.host.onRoomCheckIn?.(
      roomId,
      headerToken(req, deviceIdHeader),
      headerToken(req, operatorNameHeader),
    );
    const response = buildAssignmentResponse(snapshot, room);""",
)

test_path = Path('src/room/scorer/ScorerRecovery.test.ts')
if test_path.exists():
    raise SystemExit(f'{test_path}: already exists')
test_path.write_text(
    """import { describe, expect, it } from 'vitest';
import { gameSessionVersion, loadGame } from './GameSession';
import { readScorerRecovery, scorerRecoveryKey, scorerRecoveryVersion, validEvent } from './ScorerRecovery';

const validSetup = {
  left: { name: 'Left', players: ['Alice', 'Avery'] },
  right: { name: 'Right', players: ['Blake', 'Bailey'] },
};

function recoveryWithSetup(setup: unknown): object {
  return {
    [scorerRecoveryKey]: {
      version: scorerRecoveryVersion,
      setup,
      events: [],
    },
  };
}

describe('readScorerRecovery', () => {
  it('rejects recovery with a missing player list', () => {
    const setup = {
      left: { name: 'Left' },
      right: validSetup.right,
    };
    expect(readScorerRecovery(recoveryWithSetup(setup), validSetup)).toBeNull();
  });

  it.each([
    { label: 'non-array players', players: 'Alice' },
    { label: 'non-string player', players: ['Alice', 42] },
    { label: 'blank player', players: ['Alice', '   '] },
  ])('rejects recovery with $label', ({ players }) => {
    const setup = {
      left: { name: 'Left', players },
      right: validSetup.right,
    };
    expect(readScorerRecovery(recoveryWithSetup(setup), validSetup)).toBeNull();
  });
});

describe('loadGame', () => {
  it('rejects stored games with malformed player lists', () => {
    const now = new Date('2026-08-08T12:00:00.000Z');
    const stored = JSON.stringify({
      version: gameSessionVersion,
      gameKey: 'game-1',
      setup: {
        left: validSetup.left,
        right: { name: 'Right', players: ['Blake', ''] },
      },
      events: [],
      updatedAt: now.toISOString(),
    });
    const storage = {
      getItem: () => stored,
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    expect(loadGame('game-1', now, storage)).toBeNull();
  });
});

describe('validEvent', () => {
  const buzz = {
    id: 'buzz-1',
    type: 'tossup-buzz',
    questionNumber: 1,
    team: 'left',
    playerName: 'Alice',
    answerTypeIndex: 0,
  };

  it('rejects blank tossup player names', () => {
    expect(validEvent({ ...buzz, playerName: '   ' })).toBe(false);
  });

  it('rejects negative tossup answer type indexes', () => {
    expect(validEvent({ ...buzz, answerTypeIndex: -1 })).toBe(false);
  });
});
""",
)
