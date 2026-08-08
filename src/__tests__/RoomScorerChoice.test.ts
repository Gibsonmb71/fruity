/**
 * Which scorer a device uses, and why the answer has to outlive the URL it arrived on.
 */
import { describe, expect, test } from 'vitest';
import { clearScorerChoice, readScorerChoice } from '../room/ScorerChoice';
import { adoptRoomIdentity } from '../room/api';

function memoryStorage(initial: Record<string, string> = {}) {
  const store = { ...initial };
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    /** For assertions about what was actually persisted */
    raw: store,
  };
}

describe('the default', () => {
  test('a device that has never been told anything uses the first-party scorer', () => {
    expect(readScorerChoice({ search: '' }, memoryStorage())).toBe('first-party');
  });

  test('MODAQ is not reachable by any ordinary route', () => {
    // The point of the migration: no UI offers it, and no plain URL lands on it.
    const storage = memoryStorage();

    expect(readScorerChoice({ search: '' }, storage)).toBe('first-party');
    expect(readScorerChoice({ search: '?token=abc123' }, storage)).toBe('first-party');
    expect(readScorerChoice({ search: '?round=4&room=204' }, storage)).toBe('first-party');
  });

  test('a device with no storage at all still resolves', () => {
    expect(readScorerChoice({ search: '' }, null)).toBe('first-party');
  });
});

describe('opting into the legacy scorer', () => {
  test('?scorer=legacy selects it', () => {
    expect(readScorerChoice({ search: '?scorer=legacy' }, memoryStorage())).toBe('legacy');
  });

  test('?scorer=modaq is accepted too, since that is what it is', () => {
    expect(readScorerChoice({ search: '?scorer=modaq' }, memoryStorage())).toBe('legacy');
  });

  test('the choice is remembered, so a later load with a bare URL keeps it', () => {
    const storage = memoryStorage();

    readScorerChoice({ search: '?scorer=legacy' }, storage);

    expect(readScorerChoice({ search: '' }, storage)).toBe('legacy');
  });

  test('it survives the token strip that happens on the first load of a room URL', () => {
    // The reason this is sticky rather than read per render. adoptRoomIdentity rewrites the address
    // to drop the access token, and takes the rest of the query string with it.
    const storage = memoryStorage();
    const location = { pathname: '/room/room-204', search: '?token=secret&scorer=legacy', hash: '' };
    let rewritten = '';
    const history = {
      replaceState: (_data: unknown, _unused: string, url?: string | URL | null) => {
        rewritten = String(url ?? '');
      },
    };

    const chosen = readScorerChoice(location, storage);
    adoptRoomIdentity(location, history, storage);

    expect(chosen).toBe('legacy');
    // The flag is gone from the address...
    expect(rewritten).toBe('/room/room-204');
    // ...but the device still knows.
    expect(readScorerChoice({ search: '' }, storage)).toBe('legacy');
  });

  test('a room access token is never what gets persisted', () => {
    const storage = memoryStorage();

    readScorerChoice({ search: '?token=secret&scorer=legacy' }, storage);

    expect(JSON.stringify(storage.raw)).not.toContain('secret');
  });
});

describe('getting back', () => {
  test('?scorer=default returns to the first-party scorer', () => {
    const storage = memoryStorage();
    readScorerChoice({ search: '?scorer=legacy' }, storage);

    expect(readScorerChoice({ search: '?scorer=default' }, storage)).toBe('first-party');
    expect(readScorerChoice({ search: '' }, storage)).toBe('first-party');
  });

  test('clearScorerChoice forgets the preference', () => {
    const storage = memoryStorage();
    readScorerChoice({ search: '?scorer=legacy' }, storage);

    clearScorerChoice(storage);

    expect(readScorerChoice({ search: '' }, storage)).toBe('first-party');
  });
});

describe('parameters that mean nothing', () => {
  test('an unrecognized value leaves an opted-in device where it was', () => {
    // Resetting on a stray parameter would take a room off the scorer it was deliberately put on.
    const storage = memoryStorage();
    readScorerChoice({ search: '?scorer=legacy' }, storage);

    expect(readScorerChoice({ search: '?scorer=banana' }, storage)).toBe('legacy');
  });

  test('an unrecognized value does not opt a default device in', () => {
    expect(readScorerChoice({ search: '?scorer=banana' }, memoryStorage())).toBe('first-party');
  });

  test('a malformed query string is survivable', () => {
    expect(readScorerChoice({ search: '?%' }, memoryStorage())).toBe('first-party');
  });
});

describe('storage that refuses to cooperate', () => {
  const hostile = {
    getItem: () => {
      throw new Error('denied');
    },
    setItem: () => {
      throw new Error('denied');
    },
    removeItem: () => {
      throw new Error('denied');
    },
  };

  test('a read failure falls back to the default rather than throwing', () => {
    expect(readScorerChoice({ search: '' }, hostile)).toBe('first-party');
  });

  test('a write failure still honours the URL for this load', () => {
    expect(readScorerChoice({ search: '?scorer=legacy' }, hostile)).toBe('legacy');
  });
});
