import assert from "node:assert/strict";
import test from "node:test";
import type { TicketSnapshot } from "../shared/ticket-snapshot.ts";
import { startTrackerPoll } from "./tracker-poll.ts";

/**
 * Deterministic fake timer: callbacks are captured and fired manually, so
 * tests never sleep on wall-clock intervals (a 300 s clamp would otherwise
 * take minutes). The module calls the global clearTimeout, so stop() is
 * asserted behaviorally (no new reads after stop) rather than by timer count.
 */
function fakeTimer() {
  let nextId = 1;
  const pending = new Map<number, { cb: () => void; dueAt: number }>();
  let now = 1_000_000;
  return {
    now: () => now,
    // Fire timers in chronological order, cascading newly-scheduled ones.
    advance: (ms: number) => {
      const target = now + ms;
      let guard = 0;
      while (guard++ < 10_000) {
        let nextIdToFire: number | undefined;
        let nextDue = Infinity;
        for (const [id, entry] of pending) {
          if (entry.dueAt <= target && entry.dueAt < nextDue) {
            nextDue = entry.dueAt;
            nextIdToFire = id;
          }
        }
        if (nextIdToFire === undefined) break;
        const entry = pending.get(nextIdToFire);
        pending.delete(nextIdToFire);
        now = Math.max(now, nextDue);
        entry?.cb();
      }
      now = target;
    },
    setTimer: (cb: () => void, delayMs: number) => {
      const id = nextId++;
      pending.set(id, { cb, dueAt: now + delayMs });
      return { id, unref: () => {} } as unknown as NodeJS.Timeout;
    },
  };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function snapshot(repo: string, capturedAt: number): TicketSnapshot {
  return { repo, capturedAt, records: [] };
}

test("tracker poll: interval clamps to [2000, 300000], default 10000", async () => {
  for (const [input, expected] of [
    [0, 2000],
    [1000, 2000],
    [2000, 2000],
    [10000, 10000],
    [300000, 300000],
    [1_000_000_000, 300000],
    [undefined, 10000],
    [NaN, 10000],
  ] as const) {
    const clock = fakeTimer();
    let readCount = 0;
    const read = async () => {
      readCount++;
      return snapshot("test", clock.now());
    };
    const poll = startTrackerPoll({
      intervalMs: input as number,
      read,
      now: clock.now,
      setTimer: clock.setTimer,
    });
    // Advance one interval at a time, letting each read settle, so
    // single-flight does not suppress the later ticks.
    for (let i = 0; i < 3; i++) {
      clock.advance(expected);
      await flush();
      await flush();
    }
    const snap = poll.getSnapshot();
    poll.stop();
    assert.ok(snap, `input ${input} should have produced a snapshot`);
    assert.ok(
      readCount >= 2,
      `input ${input}: expected >=2 reads in 3 intervals, got ${readCount}`,
    );
    assert.ok(snap.capturedAt >= 1_000_000, `input ${input}`);
  }
});

test("tracker poll: single-flight prevents overlapping reads", async () => {
  const clock = fakeTimer();
  let activeReads = 0;
  let maxActive = 0;
  let release: (() => void) | undefined;
  const read = async () => {
    activeReads++;
    maxActive = Math.max(maxActive, activeReads);
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    activeReads--;
    return snapshot("test", clock.now());
  };
  const poll = startTrackerPoll({
    intervalMs: 2000,
    read,
    now: clock.now,
    setTimer: clock.setTimer,
  });
  clock.advance(2000);
  await flush();
  assert.equal(activeReads, 1);
  // A second tick must not start a second read while the first is in flight.
  clock.advance(2000);
  await flush();
  assert.equal(activeReads, 1, "overlapping read started");
  assert.equal(maxActive, 1);
  release?.();
  await flush();
  poll.stop();
});

test("tracker poll: failed read keeps previous snapshot with reason", async () => {
  const clock = fakeTimer();
  let calls = 0;
  const read = async () => {
    calls++;
    if (calls === 2) throw new Error("repo missing");
    return snapshot("test", clock.now());
  };
  const poll = startTrackerPoll({
    intervalMs: 2000,
    read,
    now: clock.now,
    setTimer: clock.setTimer,
  });
  clock.advance(2000);
  await flush();
  assert.ok(poll.getSnapshot());
  clock.advance(2000);
  await flush();
  const after = poll.getSnapshot();
  assert.ok(after, "snapshot must survive a failed read");
  assert.equal(after.reason, "repo missing");
  poll.stop();
});

test("tracker poll: stop prevents further reads", async () => {
  const clock = fakeTimer();
  let readCount = 0;
  const read = async () => {
    readCount++;
    return snapshot("test", clock.now());
  };
  const poll = startTrackerPoll({
    intervalMs: 2000,
    read,
    now: clock.now,
    setTimer: clock.setTimer,
  });
  clock.advance(2000);
  await flush();
  const afterStart = readCount;
  assert.ok(afterStart >= 1);
  poll.stop();
  clock.advance(20_000);
  await flush();
  assert.equal(readCount, afterStart, "reads continued after stop");
});
