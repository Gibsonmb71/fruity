/**
 * The promises the outbox makes about a completed game.
 *
 * Every test here is one sentence a scorekeeper or a director would say out loud, and the reason
 * they are worth pinning is that all of them are invisible on a good day: an outbox that silently
 * dropped the second result of the morning, or that cleared a game because a response arrived
 * twice, would look completely normal until the standings were short a match.
 */
import { describe, expect, test } from 'vitest';
import RoomResultOutbox, { ILegacyStorage, legacyPendingFinalKey } from '../room/OutboxStore';
import { createMemoryDriver, IOutboxDriver } from '../room/OutboxStorage';
import {
  acceptedRetentionLimit,
  baseRetryDelayMs,
  classifyDeliveryFailure,
  isDueForRetry,
  IRoomResultOutboxEntry,
  maxRetryDelayMs,
  outboxSchemaVersion,
  parseOutboxRecord,
  retryDelayMs,
  selectPrunableEntries,
} from '../room/ResultOutbox';

/** A clock the tests advance by hand, so backoff is exercised without waiting for it. */
function fakeClock(startMs = Date.parse('2026-08-07T09:00:00.000Z')) {
  let current = startMs;
  return {
    now: () => new Date(current),
    advance: (ms: number) => {
      current += ms;
    },
  };
}

function idFactory() {
  let counter = 0;
  return () => {
    counter += 1;
    return `result-${counter}`;
  };
}

function qbjFor(left: string, right: string) {
  return {
    match_teams: [{ team: { name: left } }, { team: { name: right } }],
    tossups_read: 20,
  };
}

function makeOutbox(driver: IOutboxDriver = createMemoryDriver(true), legacyStorage: ILegacyStorage | null = null) {
  const clock = fakeClock();
  const outbox = new RoomResultOutbox(driver, { now: clock.now, newId: idFactory(), legacyStorage });
  return { outbox, driver, clock };
}

function draft(left: string, right: string, roundNumber: number, sessionId = `session-${roundNumber}`) {
  return {
    roundNumber,
    roundName: String(roundNumber),
    leftTeam: left,
    rightTeam: right,
    qbj: qbjFor(left, right),
    deliveryState: 'queued' as const,
    sessionCredentials: { sessionId, token: `token-${sessionId}` },
  };
}

describe('holding more than one result', () => {
  test('a second finished game does not replace the first', async () => {
    const { outbox } = makeOutbox();

    await outbox.enqueue(draft('Ninety Six A', 'Greenwood', 4));
    await outbox.enqueue(draft('Ninety Six A', 'Emerald', 5));

    expect(
      outbox
        .list()
        .map((entry) => entry.roundNumber)
        .sort(),
    ).toEqual([4, 5]);
  });

  test('the results are still there after a reload', async () => {
    const driver = createMemoryDriver(true);
    const first = makeOutbox(driver);
    await first.outbox.enqueue(draft('Ninety Six A', 'Greenwood', 4));
    await first.outbox.enqueue(draft('Ninety Six A', 'Emerald', 5));

    // A fresh store over the same driver is what a page reload actually is.
    const reloaded = new RoomResultOutbox(driver, { legacyStorage: null });
    const loaded = await reloaded.load();

    expect(loaded.entries).toHaveLength(2);
    expect(loaded.skipped).toBe(0);
  });

  test('reloading twice does not duplicate anything', async () => {
    const driver = createMemoryDriver(true);
    const { outbox } = makeOutbox(driver);
    await outbox.enqueue(draft('Ninety Six A', 'Greenwood', 4));

    await new RoomResultOutbox(driver, { legacyStorage: null }).load();
    const third = new RoomResultOutbox(driver, { legacyStorage: null });
    const loaded = await third.load();

    expect(loaded.entries).toHaveLength(1);
  });
});

describe('records the store cannot read', () => {
  test('a malformed record is skipped rather than taking the good ones with it', async () => {
    const driver = createMemoryDriver(true);
    await driver.write({ id: 'broken' } as never);
    await driver.write({ id: 'also-broken', schemaVersion: 1, leftTeam: 'A' } as never);
    const { outbox } = makeOutbox(driver);

    await outbox.enqueue(draft('Ninety Six A', 'Greenwood', 4));
    const reloaded = new RoomResultOutbox(driver, { legacyStorage: null });
    const loaded = await reloaded.load();

    expect(loaded.skipped).toBe(2);
    expect(loaded.entries).toHaveLength(1);
    expect(loaded.entries[0].leftTeam).toBe('Ninety Six A');
  });

  test('a malformed record is left in the store rather than destroyed', async () => {
    const driver = createMemoryDriver(true);
    await driver.write({ id: 'broken', schemaVersion: 1 } as never);
    const { outbox } = makeOutbox(driver);
    await outbox.load();

    // Whatever it was, it is somebody's game. It stays where a human can still find it.
    expect((await driver.readAll()).some((record) => record.id === 'broken')).toBe(true);
  });

  test('a record written by a newer bundle is left alone', () => {
    const parsed = parseOutboxRecord({
      id: 'from-the-future',
      schemaVersion: outboxSchemaVersion + 1,
      leftTeam: 'A',
      rightTeam: 'B',
      qbj: {},
      createdAt: '2026-08-07T09:00:00.000Z',
      deliveryState: 'queued',
    });

    expect(parsed).toBeNull();
  });
});

describe('migrating the single-result predecessor', () => {
  function legacyStorage(initial: Record<string, string>): ILegacyStorage & { store: Record<string, string> } {
    const store = { ...initial };
    return {
      store,
      getItem: (key) => store[key] ?? null,
      removeItem: (key) => {
        delete store[key];
      },
    };
  }

  test('the old record becomes an outbox entry and the old key is cleared', async () => {
    const storage = legacyStorage({
      [legacyPendingFinalKey]: JSON.stringify({
        credentials: { sessionId: 'legacy-session', token: 'legacy-token' },
        qbj: qbjFor('Ninety Six A', 'Greenwood'),
        queuedAt: '2026-08-07T08:30:00.000Z',
        attempts: 3,
      }),
    });
    const { outbox } = makeOutbox(createMemoryDriver(true), storage);

    const loaded = await outbox.load();

    expect(loaded.migrated).toBe(1);
    expect(loaded.entries).toHaveLength(1);
    expect(loaded.entries[0].sessionCredentials?.sessionId).toBe('legacy-session');
    expect(loaded.entries[0].leftTeam).toBe('Ninety Six A');
    expect(loaded.entries[0].attempts).toBe(3);
    expect(storage.store[legacyPendingFinalKey]).toBeUndefined();
  });

  test('the old record survives when the new write fails', async () => {
    const storage = legacyStorage({
      [legacyPendingFinalKey]: JSON.stringify({
        credentials: { sessionId: 'legacy-session', token: 'legacy-token' },
        qbj: qbjFor('Ninety Six A', 'Greenwood'),
      }),
    });
    const failing: IOutboxDriver = {
      durable: true,
      readAll: async () => [],
      write: async () => {
        throw new Error('quota');
      },
      remove: async () => undefined,
      clear: async () => undefined,
    };
    const outbox = new RoomResultOutbox(failing, { legacyStorage: storage });

    const loaded = await outbox.load();

    expect(loaded.migrated).toBe(0);
    // The only copy of that game must not be thrown away because the replacement failed.
    expect(storage.store[legacyPendingFinalKey]).toBeDefined();
  });

  test('a record that is not readable at all is left exactly where it is', async () => {
    const storage = legacyStorage({ [legacyPendingFinalKey]: 'not json' });
    const { outbox } = makeOutbox(createMemoryDriver(true), storage);

    const loaded = await outbox.load();

    expect(loaded.migrated).toBe(0);
    expect(storage.store[legacyPendingFinalKey]).toBe('not json');
  });

  test('migrating twice does not produce two entries', async () => {
    const legacyRecord = JSON.stringify({
      credentials: { sessionId: 'legacy-session', token: 'legacy-token' },
      qbj: qbjFor('Ninety Six A', 'Greenwood'),
    });
    const driver = createMemoryDriver(true);
    await new RoomResultOutbox(driver, {
      legacyStorage: legacyStorage({ [legacyPendingFinalKey]: legacyRecord }),
    }).load();
    // Simulate the key surviving a crash between the write and the clear.
    const second = new RoomResultOutbox(driver, {
      legacyStorage: legacyStorage({ [legacyPendingFinalKey]: legacyRecord }),
    });

    const loaded = await second.load();

    expect(loaded.entries).toHaveLength(1);
  });
});

describe('persisting before uploading', () => {
  test('the result is in the store before any delivery is attempted', async () => {
    const driver = createMemoryDriver(true);
    const { outbox } = makeOutbox(driver);
    const writtenBeforeDelivery: number[] = [];

    const enqueued = await outbox.enqueue(draft('Ninety Six A', 'Greenwood', 4));
    await outbox.deliverOne(enqueued.entry.id, async () => {
      writtenBeforeDelivery.push((await driver.readAll()).length);
      return { ok: true, newSubmission: true };
    });

    expect(enqueued.persisted).toBe(true);
    expect(writtenBeforeDelivery).toEqual([1]);
  });

  test('a store that refuses the write says so instead of claiming the result is safe', async () => {
    const failing: IOutboxDriver = {
      durable: true,
      readAll: async () => [],
      write: async () => {
        throw new Error('This browser is out of storage.');
      },
      remove: async () => undefined,
      clear: async () => undefined,
    };
    const outbox = new RoomResultOutbox(failing, { legacyStorage: null });

    const enqueued = await outbox.enqueue(draft('Ninety Six A', 'Greenwood', 4));

    expect(enqueued.persisted).toBe(false);
    expect(enqueued.error).toBe('This browser is out of storage.');
    // The result still exists in memory, so it can be downloaded immediately.
    expect(outbox.list()).toHaveLength(1);
  });
});

describe('retrying', () => {
  test('the backoff doubles and then stops growing', () => {
    expect(retryDelayMs(0)).toBe(baseRetryDelayMs);
    expect(retryDelayMs(1)).toBe(baseRetryDelayMs * 2);
    expect(retryDelayMs(2)).toBe(baseRetryDelayMs * 4);
    expect(retryDelayMs(50)).toBe(maxRetryDelayMs);
  });

  test('a transport failure is retried and a lost session is not', () => {
    expect(classifyDeliveryFailure(undefined, 'no answer').kind).toBe('retry');
    expect(classifyDeliveryFailure(503, 'busy').kind).toBe('retry');
    expect(classifyDeliveryFailure(429, 'slow down').kind).toBe('retry');
    expect(classifyDeliveryFailure(404, 'no such session').kind).toBe('permanent');
    expect(classifyDeliveryFailure(403, 'not authorized').kind).toBe('permanent');
    expect(classifyDeliveryFailure(409, 'already resolved').kind).toBe('permanent');
  });

  test('an entry is not retried before its backoff has elapsed', async () => {
    const clock = fakeClock();
    const outbox = new RoomResultOutbox(createMemoryDriver(true), {
      now: clock.now,
      newId: idFactory(),
      legacyStorage: null,
    });
    await outbox.enqueue(draft('Ninety Six A', 'Greenwood', 4));

    let attempts = 0;
    const failOnce = async () => {
      attempts += 1;
      return { ok: false as const, error: 'Could not reach the YellowFruit computer.' };
    };

    await outbox.flush(failOnce);
    expect(attempts).toBe(1);

    // Immediately afterwards there is nothing due.
    await outbox.flush(failOnce);
    expect(attempts).toBe(1);

    clock.advance(retryDelayMs(1) + 1);
    await outbox.flush(failOnce);
    expect(attempts).toBe(2);
  });

  test('a permanent refusal stops automatic retry and keeps the result', async () => {
    const { outbox } = makeOutbox();
    const enqueued = await outbox.enqueue(draft('Ninety Six A', 'Greenwood', 4));

    await outbox.deliverOne(enqueued.entry.id, async () => ({
      ok: false,
      status: 404,
      error: 'No such session.',
    }));

    const entry = outbox.find(enqueued.entry.id);
    expect(entry?.retryBlocked).toBe(true);
    expect(entry?.lastError).toBe('No such session.');
    // Kept, not discarded: the file is now the only route into the tournament.
    expect(outbox.list()).toHaveLength(1);
    expect(isDueForRetry(entry as IRoomResultOutboxEntry, Date.now() + 10 * 60 * 1000)).toBe(false);
  });

  test('a lost response does not create a second result', async () => {
    const { outbox } = makeOutbox();
    const first = await outbox.enqueue(draft('Ninety Six A', 'Greenwood', 4));

    // The upload landed but the answer never came back, so the room enqueues the same final again.
    await outbox.deliverOne(first.entry.id, async () => ({ ok: false, error: 'Could not reach the computer.' }));
    const second = await outbox.enqueue(draft('Ninety Six A', 'Greenwood', 4));

    expect(second.deduplicated).toBe(true);
    expect(second.entry.id).toBe(first.entry.id);
    expect(outbox.list()).toHaveLength(1);
  });

  test('a manual backup is never delivered automatically', async () => {
    const { outbox } = makeOutbox();
    await outbox.enqueue({
      roundNumber: 4,
      roundName: '4',
      leftTeam: 'Ninety Six A',
      rightTeam: 'Greenwood',
      qbj: qbjFor('Ninety Six A', 'Greenwood'),
      deliveryState: 'manual-backup',
    });

    let attempts = 0;
    await outbox.flush(async () => {
      attempts += 1;
      return { ok: true, newSubmission: true };
    });

    expect(attempts).toBe(0);
    expect(outbox.list()[0].deliveryState).toBe('manual-backup');
  });
});

describe('what happens after tournament control decides', () => {
  test('a submitted result keeps its local copy', async () => {
    const { outbox } = makeOutbox();
    const enqueued = await outbox.enqueue(draft('Ninety Six A', 'Greenwood', 4));

    await outbox.deliverOne(enqueued.entry.id, async () => ({ ok: true, newSubmission: true }));

    expect(outbox.find(enqueued.entry.id)?.deliveryState).toBe('submitted');
    expect(outbox.list()).toHaveLength(1);
  });

  test('a rejected result is retained so the room can correct it', async () => {
    const { outbox } = makeOutbox();
    const enqueued = await outbox.enqueue(draft('Ninety Six A', 'Greenwood', 4));

    await outbox.markNeedsCorrection(enqueued.entry.id, 'Bonus points do not add up.');

    const entry = outbox.find(enqueued.entry.id);
    expect(entry?.deliveryState).toBe('needs-correction');
    expect(entry?.lastError).toBe('Bonus points do not add up.');
    await outbox.prune();
    expect(outbox.list()).toHaveLength(1);
  });

  test('only accepted results are ever pruned, and only past the retention limit', async () => {
    const entries: IRoomResultOutboxEntry[] = [];
    for (let index = 0; index < acceptedRetentionLimit + 3; index += 1) {
      entries.push({
        id: `accepted-${String(index).padStart(3, '0')}`,
        leftTeam: 'A',
        rightTeam: 'B',
        qbj: {},
        createdAt: `2026-08-07T09:${String(index).padStart(2, '0')}:00.000Z`,
        updatedAt: `2026-08-07T09:${String(index).padStart(2, '0')}:00.000Z`,
        deliveryState: 'accepted',
        attempts: 1,
      });
    }
    entries.push({
      id: 'ancient-but-unresolved',
      leftTeam: 'A',
      rightTeam: 'B',
      qbj: {},
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z',
      deliveryState: 'queued',
      attempts: 99,
    });

    const prunable = selectPrunableEntries(entries);

    expect(prunable).toHaveLength(3);
    expect(prunable.every((entry) => entry.deliveryState === 'accepted')).toBe(true);
    expect(prunable.map((entry) => entry.id)).toEqual(['accepted-002', 'accepted-001', 'accepted-000']);
  });

  test('an unresolved result cannot be removed even when asked directly', async () => {
    const { outbox } = makeOutbox();
    const enqueued = await outbox.enqueue(draft('Ninety Six A', 'Greenwood', 4));

    await outbox.remove(enqueued.entry.id);

    expect(outbox.list()).toHaveLength(1);
  });

  test('pruning an accepted result removes it from the store as well as the list', async () => {
    const driver = createMemoryDriver(true);
    const { outbox } = makeOutbox(driver);
    const enqueued = await outbox.enqueue(draft('Ninety Six A', 'Greenwood', 4));
    await outbox.markAccepted(enqueued.entry.id);

    await outbox.remove(enqueued.entry.id);

    expect(outbox.list()).toHaveLength(0);
    expect(await driver.readAll()).toHaveLength(0);
  });
});
