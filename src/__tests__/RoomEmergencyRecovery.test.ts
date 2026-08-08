import { describe, expect, test } from 'vitest';
import { readEmergencyGameState, writeEmergencyGameState } from '../room/ManualRoomApp';

function memoryStorage() {
  const values: Record<string, string> = {};
  return {
    getItem: (key: string) => values[key] ?? null,
    setItem: (key: string, value: string) => {
      values[key] = value;
    },
    removeItem: (key: string) => {
      delete values[key];
    },
  };
}

const game = {
  gameId: 'emergency-5-game',
  tournamentKey: 'tournament-1',
  roundNumber: 5,
  leftTeamName: 'Ninety Six',
  rightTeamName: 'Greenwood',
  scorer: 'first-party' as const,
};

describe('emergency game recovery', () => {
  test('restores the scorer that created the game', () => {
    const storage = memoryStorage();

    writeEmergencyGameState(game, storage);

    expect(readEmergencyGameState(storage)).toEqual(game);
  });

  test('old emergency records without a scorer remain legacy games', () => {
    const storage = memoryStorage();
    writeEmergencyGameState({ ...game, scorer: 'legacy' }, storage);

    const raw = JSON.parse(storage.getItem('yellowfruit.room.emergency-game.v1')!);
    delete raw.scorer;
    storage.setItem('yellowfruit.room.emergency-game.v1', JSON.stringify(raw));

    expect(readEmergencyGameState(storage)?.scorer).toBe('legacy');
  });
});
