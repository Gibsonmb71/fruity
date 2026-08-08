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
  awaitsAutomaticDelivery,
  baseRetryDelayMs,
  blocksNewStart,
  classifyDeliveryFailure,
  describeDeliveryState,
  isDueForRetry,
  needsAction,
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
        .sort((left, right) => (left ?? 0) - (right ?? 0)),
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
    // A session the server has explicitly finished with, and a refusal of these particular bytes:
    // both decide whether the room retries forever or hands the file to a person.
    expect(classifyDeliveryFailure(410, 'session closed').kind).toBe('permanent');
    expect(classifyDeliveryFailure(422, 'that payload is not valid').kind).toBe('permanent');
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
    const { outbox, clock } = makeOutbox();
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
    const blockedEntry = entry as IRoomResultOutboxEntry;
    clock.advance(retryDelayMs(blockedEntry.attempts) + 1);
    expect(clock.now().getTime()).toBeGreaterThan(new Date(blockedEntry.lastAttemptAt as string).getTime());
    expect(isDueForRetry(blockedEntry, clock.now().getTime())).toBe(false);
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

describe('what "saved on this Chromebook" is allowed to mean', () => {
  /** A driver that is durable in principle but fails a chosen number of writes. */
  function flakyDriver(failuresBeforeSuccess: number): IOutboxDriver & { writes: number } {
    const records = new Map<string, { id: string }>();
    return {
      durable: true,
      writes: 0,
      readAll: async () => Array.from(records.values()).map((record) => ({ ...record })),
      // eslint-disable-next-line func-names
      write: async function write(this: { writes: number }, record) {
        this.writes += 1;
        if (this.writes <= failuresBeforeSuccess) throw new Error('This browser is out of storage.');
        records.set(record.id, { ...record });
      },
      remove: async (id) => {
        records.delete(id);
      },
      clear: async () => {
        records.clear();
      },
    };
  }

  test('a durable store that failed this write does not report the result as saved', async () => {
    // The bug this pins: `driver.durable` is true for IndexedDB even when the write that just
    // happened threw, so reporting it would tell a scorekeeper their game is safe on the device when
    // it exists only in this page's memory.
    const driver = flakyDriver(1);
    const outbox = new RoomResultOutbox(driver, { legacyStorage: null, newId: idFactory() });

    const first = await outbox.enqueue(draft('Ninety Six A', 'Greenwood', 4));

    expect(first.persisted).toBe(false);
    expect(outbox.isPersisted(first.entry.id)).toBe(false);
  });

  test('re-enqueueing the same result does not upgrade a failed write to saved', async () => {
    // Both writes fail, so the dedupe path must keep saying false however many times it is asked.
    const driver = flakyDriver(2);
    const outbox = new RoomResultOutbox(driver, { legacyStorage: null, newId: idFactory() });

    const first = await outbox.enqueue(draft('Ninety Six A', 'Greenwood', 4));
    const second = await outbox.enqueue(draft('Ninety Six A', 'Greenwood', 4));

    expect(first.persisted).toBe(false);
    expect(second.deduplicated).toBe(true);
    expect(second.entry.id).toBe(first.entry.id);
    expect(second.persisted).toBe(false);
    expect(second.error).toBeDefined();
    expect(outbox.list()).toHaveLength(1);
  });

  test('re-enqueueing retries the write, and reports saved only once one lands', async () => {
    const driver = flakyDriver(1);
    const outbox = new RoomResultOutbox(driver, { legacyStorage: null, newId: idFactory() });

    const first = await outbox.enqueue(draft('Ninety Six A', 'Greenwood', 4));
    const second = await outbox.enqueue(draft('Ninety Six A', 'Greenwood', 4));

    expect(first.persisted).toBe(false);
    expect(second.persisted).toBe(true);
    expect(outbox.isPersisted(first.entry.id)).toBe(true);
    expect(await driver.readAll()).toHaveLength(1);
  });

  test('an in-memory store never claims a result is saved, even after a successful write', async () => {
    const outbox = new RoomResultOutbox(createMemoryDriver(false), { legacyStorage: null, newId: idFactory() });

    const enqueued = await outbox.enqueue(draft('Ninety Six A', 'Greenwood', 4));

    expect(enqueued.persisted).toBe(false);
  });
});

describe('correcting a result tournament control sent back', () => {
  async function rejectedEntry() {
    const { outbox } = makeOutbox();
    const enqueued = await outbox.enqueue({ ...draft('Ninety Six A', 'Greenwood', 4), scheduledMatchId: 'sched-a' });
    await outbox.deliverOne(enqueued.entry.id, async () => ({ ok: true, newSubmission: true }));
    await outbox.markNeedsCorrection(enqueued.entry.id, 'Bonus points do not add up.');
    return { outbox, id: enqueued.entry.id };
  }

  test('an unchanged corrected payload is resubmitted rather than silently doing nothing', async () => {
    // The failure this pins: the corrected export deduped onto the needs-correction entry, and
    // deliverOne only touches `queued`, so pressing submit did nothing at all.
    const { outbox, id } = await rejectedEntry();

    const corrected = await outbox.enqueue({
      ...draft('Ninety Six A', 'Greenwood', 4),
      scheduledMatchId: 'sched-a',
    });

    expect(corrected.entry.id).toBe(id);
    expect(corrected.supersededCorrection).toBe(true);
    expect(outbox.find(id)?.deliveryState).toBe('queued');

    let sent = 0;
    await outbox.deliverOne(id, async () => {
      sent += 1;
      return { ok: true, newSubmission: true };
    });

    expect(sent).toBe(1);
    expect(outbox.find(id)?.deliveryState).toBe('submitted');
  });

  test('a changed corrected payload replaces the rejected result instead of adding a second', async () => {
    const { outbox, id } = await rejectedEntry();
    const correctedQbj = { ...qbjFor('Ninety Six A', 'Greenwood'), tossups_read: 21 };

    const corrected = await outbox.enqueue({
      ...draft('Ninety Six A', 'Greenwood', 4),
      scheduledMatchId: 'sched-a',
      qbj: correctedQbj,
    });

    expect(corrected.entry.id).toBe(id);
    expect(outbox.list()).toHaveLength(1);
    const entry = outbox.find(id);
    expect(entry?.deliveryState).toBe('queued');
    expect((entry?.qbj as { tossups_read: number }).tossups_read).toBe(21);
  });

  test('a correction starts its backoff over rather than inheriting the rejected attempt', async () => {
    const { outbox, id } = await rejectedEntry();

    await outbox.enqueue({ ...draft('Ninety Six A', 'Greenwood', 4), scheduledMatchId: 'sched-a' });

    const entry = outbox.find(id);
    expect(entry?.attempts).toBe(0);
    expect(entry?.lastAttemptAt).toBeUndefined();
    expect(entry?.retryBlocked).toBeUndefined();
    expect(entry?.lastError).toBeUndefined();
  });

  test('a different game is not swallowed by an outstanding correction', async () => {
    const { outbox } = await rejectedEntry();

    const other = await outbox.enqueue({
      ...draft('Ninety Six A', 'Emerald', 5, 'session-5'),
      scheduledMatchId: 'sched-b',
    });

    expect(other.supersededCorrection).toBeUndefined();
    expect(outbox.list()).toHaveLength(2);
  });

  test('an emergency backup never supersedes a rejected assigned result', async () => {
    const { outbox } = await rejectedEntry();

    await outbox.enqueue({
      roundNumber: 4,
      roundName: '4',
      leftTeam: 'Ninety Six A',
      rightTeam: 'Greenwood',
      qbj: qbjFor('Ninety Six A', 'Greenwood'),
      deliveryState: 'manual-backup',
      scheduledMatchId: 'sched-a',
    });

    expect(outbox.list()).toHaveLength(2);
    expect(outbox.list().some((entry) => entry.deliveryState === 'needs-correction')).toBe(true);
  });
});

describe('a result nothing will ever manage to send', () => {
  test('a stranded result stops blocking once the scorekeeper says it was handed over', async () => {
    // After a server replacement the session is gone, so this result is permanently undeliverable.
    // The director recovers it by importing the file — which creates no session, so nothing will
    // ever come back to mark it accepted. Without this, the room could not start another game.
    const { outbox } = makeOutbox();
    const enqueued = await outbox.enqueue({ ...draft('Ninety Six A', 'Greenwood', 4), scheduledMatchId: 'sched-a' });
    await outbox.deliverOne(enqueued.entry.id, async () => ({
      ok: false,
      status: 404,
      error: 'No such session.',
    }));

    expect(blocksNewStart(outbox.find(enqueued.entry.id) as IRoomResultOutboxEntry, 'sched-a')).toBe(true);

    await outbox.markHandedOver(enqueued.entry.id);

    const entry = outbox.find(enqueued.entry.id) as IRoomResultOutboxEntry;
    expect(entry.handedOver).toBe(true);
    expect(blocksNewStart(entry, 'sched-a')).toBe(false);
    // The result and its file are still there.
    expect(outbox.list()).toHaveLength(1);
    expect(entry.qbj).toBeDefined();
  });

  test('an undelivered result for an earlier game does not gate the game in front of the room', async () => {
    const { outbox } = makeOutbox();
    const stale = await outbox.enqueue({ ...draft('Ninety Six A', 'Greenwood', 4), scheduledMatchId: 'sched-r4' });

    // The room has moved on to round 5.
    expect(blocksNewStart(stale.entry, 'sched-r5')).toBe(false);
    expect(blocksNewStart(stale.entry, 'sched-r4')).toBe(true);
  });

  test('an accepted result and an emergency copy never gate a start', async () => {
    const { outbox } = makeOutbox();
    const accepted = await outbox.enqueue({ ...draft('Ninety Six A', 'Greenwood', 4), scheduledMatchId: 'sched-a' });
    await outbox.markAccepted(accepted.entry.id);
    const emergency = await outbox.enqueue({
      roundNumber: 5,
      roundName: '5',
      leftTeam: 'Ninety Six A',
      rightTeam: 'Emerald',
      qbj: qbjFor('Ninety Six A', 'Emerald'),
      deliveryState: 'manual-backup',
      scheduledMatchId: 'sched-a',
    });

    expect(blocksNewStart(outbox.find(accepted.entry.id) as IRoomResultOutboxEntry, 'sched-a')).toBe(false);
    expect(blocksNewStart(emergency.entry, 'sched-a')).toBe(false);
  });

  test('the handed-over state survives a reload', async () => {
    const driver = createMemoryDriver(true);
    const { outbox } = makeOutbox(driver);
    const enqueued = await outbox.enqueue({ ...draft('Ninety Six A', 'Greenwood', 4), scheduledMatchId: 'sched-a' });
    await outbox.markHandedOver(enqueued.entry.id);

    const reloaded = new RoomResultOutbox(driver, { legacyStorage: null });
    const loaded = await reloaded.load();

    expect(loaded.entries[0].handedOver).toBe(true);
  });

  test('nothing is left waiting on a handed-over result, but the file stays', async () => {
    const { outbox } = makeOutbox();
    const enqueued = await outbox.enqueue({ ...draft('Ninety Six A', 'Greenwood', 4), scheduledMatchId: 'sched-a' });
    await outbox.deliverOne(enqueued.entry.id, async () => ({ ok: false, status: 404, error: 'No such session.' }));

    await outbox.markHandedOver(enqueued.entry.id);
    const entry = outbox.find(enqueued.entry.id) as IRoomResultOutboxEntry;

    // The page must stop saying a finished game is waiting to be sent and stop warning on the way
    // out, or it contradicts the confirmation the scorekeeper just gave.
    expect(needsAction(entry)).toBe(false);
    expect(awaitsAutomaticDelivery(entry)).toBe(false);
    expect(isDueForRetry(entry, Date.parse('2026-08-07T23:00:00.000Z'))).toBe(false);
    // But it is still here, and still downloadable.
    expect(outbox.list()).toHaveLength(1);
    expect(describeDeliveryState(entry)).toBe('Handed to tournament control');
  });

  test('a correction of a handed-over result is delivered like any other', async () => {
    const { outbox } = makeOutbox();
    const enqueued = await outbox.enqueue({ ...draft('Ninety Six A', 'Greenwood', 4), scheduledMatchId: 'sched-a' });
    await outbox.markHandedOver(enqueued.entry.id);
    await outbox.markNeedsCorrection(enqueued.entry.id, 'Bonus 12 was scored twice.');

    // The scorekeeper fixes the game and submits again. The handover was about the bytes control
    // sent back, not about these — leaving the claim on would strand the correction: nothing
    // retries a handed-over entry and nothing on screen says one is waiting.
    const corrected = await outbox.enqueue({
      ...draft('Ninety Six A', 'Greenwood', 4),
      scheduledMatchId: 'sched-a',
      qbj: qbjFor('Ninety Six A', 'Greenwood'),
    });

    expect(corrected.supersededCorrection).toBe(true);
    const entry = outbox.find(corrected.entry.id) as IRoomResultOutboxEntry;
    expect(entry.handedOver).toBeUndefined();
    expect(entry.deliveryState).toBe('queued');
    expect(needsAction(entry)).toBe(true);
    expect(awaitsAutomaticDelivery(entry)).toBe(true);
    expect(isDueForRetry(entry, Date.parse('2026-08-07T23:00:00.000Z'))).toBe(true);
    expect(outbox.list()).toHaveLength(1);
  });

  test('a handed-over result that tournament control sends back still needs the room', async () => {
    const { outbox } = makeOutbox();
    const enqueued = await outbox.enqueue({ ...draft('Ninety Six A', 'Greenwood', 4), scheduledMatchId: 'sched-a' });
    await outbox.markHandedOver(enqueued.entry.id);

    await outbox.markNeedsCorrection(enqueued.entry.id, 'Bonus 12 was scored twice.');

    // A correction request is a new instruction about this game; handing the file over earlier does
    // not answer it.
    expect(needsAction(outbox.find(enqueued.entry.id) as IRoomResultOutboxEntry)).toBe(true);
  });

  test('a result being retried automatically is still waiting on something', async () => {
    const { outbox } = makeOutbox();
    const enqueued = await outbox.enqueue(draft('Ninety Six A', 'Greenwood', 4));

    expect(needsAction(enqueued.entry)).toBe(true);
    expect(awaitsAutomaticDelivery(enqueued.entry)).toBe(true);
  });

  test('a permanently refused result is waiting on a person, not on the network', async () => {
    const { outbox } = makeOutbox();
    const enqueued = await outbox.enqueue(draft('Ninety Six A', 'Greenwood', 4));
    await outbox.deliverOne(enqueued.entry.id, async () => ({ ok: false, status: 404, error: 'No such session.' }));
    const entry = outbox.find(enqueued.entry.id) as IRoomResultOutboxEntry;

    expect(needsAction(entry)).toBe(true);
    // Nothing will send it, so nothing may promise it will go automatically.
    expect(awaitsAutomaticDelivery(entry)).toBe(false);
  });

  test('an accepted result cannot be marked handed over', async () => {
    const { outbox } = makeOutbox();
    const enqueued = await outbox.enqueue(draft('Ninety Six A', 'Greenwood', 4));
    await outbox.markAccepted(enqueued.entry.id);

    await outbox.markHandedOver(enqueued.entry.id);

    expect(outbox.find(enqueued.entry.id)?.handedOver).toBeUndefined();
  });
});
