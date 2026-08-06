import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import type { TicketSnapshot } from "../shared/ticket-snapshot.ts";
import {
  TICKET_SNAPSHOT_CHANNEL,
  readTrackerSnapshotForPoll,
  startTrackerPolling,
} from "./index.ts";
import { startTrackerPoll } from "./tracker-poll.ts";

/**
 * Deterministic fake timer: callbacks are captured and fired manually, so
 * tests never sleep on wall-clock intervals (a 300 s clamp would otherwise
 * take minutes). It also models cancellation so stop() can prove no timers
 * remain scheduled.
 */
function fakeTimer() {
  let nextId = 1;
  const pending = new Map<number, { cb: () => void; dueAt: number }>();
  const delays: number[] = [];
  let clearCount = 0;
  let unrefCount = 0;
  let now = 1_000_000;
  return {
    now: () => now,
    delays,
    pendingCount: () => pending.size,
    clearCount: () => clearCount,
    unrefCount: () => unrefCount,
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
      delays.push(delayMs);
      pending.set(id, { cb, dueAt: now + delayMs });
      return {
        id,
        unref: () => {
          unrefCount++;
        },
      } as unknown as NodeJS.Timeout;
    },
    clearTimer: (handle: NodeJS.Timeout) => {
      const { id } = handle as unknown as { id: number };
      if (pending.delete(id)) clearCount++;
    },
  };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function snapshot(repo: string, capturedAt: number): TicketSnapshot {
  return { repo, capturedAt, records: [] };
}

function record(repo: string, id: string) {
  return {
    repo,
    id,
    title: id,
    status: "planned" as const,
    blockedBy: [],
    blocking: "unblocked" as const,
    eta: { kind: "unknown" as const },
  };
}

test("settings example exposes the default tracker poll interval", () => {
  const settings = JSON.parse(
    readFileSync(
      new URL("../../settings.example.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(settings.workflow.trackerPollMs, 10000);
});

test("tracker poll stays read-only and off the render path", () => {
  const source = readFileSync(
    new URL("./tracker-poll.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /node:(fs|child_process|http|https|net)/);
  assert.doesNotMatch(source, /\b(writeFile|rename|exec|spawn)\s*\(/);
  assert.doesNotMatch(source, /git\s+(commit|push)/i);
});

test("tracker poll: interval clamps to [2000, 300000], default 10000", async () => {
  for (const [input, expected] of [
    [-1, 2000],
    [0, 2000],
    [1000, 2000],
    [2000, 2000],
    [10000, 10000],
    [300000, 300000],
    [1_000_000_000, 300000],
    [Infinity, 10000],
    [-Infinity, 10000],
    ["2000", 10000],
    [null, 10000],
    [undefined, 10000],
    [NaN, 10000],
  ] as const) {
    const clock = fakeTimer();
    const read = async () => snapshot("test", clock.now());
    const poll = startTrackerPoll({
      intervalMs: input as unknown as number,
      read,
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });
    assert.equal(clock.delays[0], expected, `input ${input}`);
    clock.advance(expected);
    await flush();
    await flush();
    const snap = poll.getSnapshot();
    poll.stop();
    assert.ok(snap, `input ${input} should have produced a snapshot`);
    assert.ok(snap.capturedAt >= 1_000_000, `input ${input}`);
  }
});

test("tracker poll: each settled interval invokes one read", async () => {
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
    clearTimer: clock.clearTimer,
  });
  for (let interval = 0; interval < 5; interval++) {
    clock.advance(2000);
    await flush();
    await flush();
  }
  assert.equal(readCount, 5);
  poll.stop();
});

test("tracker poll: single-flight prevents overlapping reads for 10 intervals", async () => {
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
    clearTimer: clock.clearTimer,
  });
  for (let interval = 0; interval < 10; interval++) {
    clock.advance(2000);
    await flush();
  }
  assert.equal(activeReads, 1);
  assert.equal(maxActive, 1, "overlapping read started");
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
    clearTimer: clock.clearTimer,
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

test("tracker poll: unavailable or foreign repositories never replace prior records", async () => {
  const clock = fakeTimer();
  let calls = 0;
  const first = {
    ...snapshot("alpha", clock.now()),
    records: [record("alpha", "PI-1")],
  } satisfies TicketSnapshot;
  const foreign = {
    ...snapshot("beta", clock.now()),
    records: [record("beta", "PI-2")],
  } satisfies TicketSnapshot;
  const read = () => {
    calls++;
    if (calls === 1) return Promise.resolve(first);
    if (calls === 2)
      return Promise.resolve({ ...foreign, reason: "unavailable" });
    return Promise.resolve(foreign);
  };
  const poll = startTrackerPoll({
    intervalMs: 2000,
    read,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });

  clock.advance(2000);
  await flush();
  const stored = poll.getSnapshot();
  assert.ok(stored);
  clock.advance(2000);
  await flush();
  const unavailable = poll.getSnapshot();
  assert.ok(unavailable);
  assert.equal(unavailable.repo, "alpha");
  assert.equal(unavailable.capturedAt, stored.capturedAt);
  assert.deepEqual(unavailable.records, stored.records);
  assert.equal(unavailable.reason, "unavailable");

  clock.advance(2000);
  await flush();
  const foreignSuccess = poll.getSnapshot();
  assert.ok(foreignSuccess);
  assert.equal(foreignSuccess.repo, "alpha");
  assert.deepEqual(foreignSuccess.records, stored.records);
  assert.equal(foreignSuccess.reason, "repository changed");
  poll.stop();
});

test("tracker poll: timeout preserves the prior snapshot and stays single-flight", async () => {
  const clock = fakeTimer();
  let calls = 0;
  let resolveSlow: ((value: TicketSnapshot) => void) | undefined;
  const slow = new Promise<TicketSnapshot>((resolve) => {
    resolveSlow = resolve;
  });
  const read = () => {
    calls++;
    return calls === 2 ? slow : Promise.resolve(snapshot("test", clock.now()));
  };
  const poll = startTrackerPoll({
    intervalMs: 2000,
    read,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });

  clock.advance(2000);
  await flush();
  const first = poll.getSnapshot();
  assert.ok(first);
  const firstCapturedAt = first.capturedAt;

  clock.advance(2000);
  await flush();
  clock.advance(2000);
  await flush();
  const timedOut = poll.getSnapshot();
  assert.ok(timedOut);
  assert.equal(calls, 2);
  assert.equal(timedOut.capturedAt, firstCapturedAt);
  assert.equal(timedOut.repo, "test");
  assert.equal(timedOut.reason, "timeout");

  resolveSlow?.(snapshot("test", clock.now()));
  await flush();
  clock.advance(2000);
  await flush();
  assert.equal(
    calls,
    3,
    "a settled timed-out read should permit the next tick",
  );
  poll.stop();
});

test("tracker poll: thrown and malformed reads become non-empty reasoned failures", async () => {
  const clock = fakeTimer();
  let calls = 0;
  const read = () => {
    calls++;
    if (calls === 2) throw new Error();
    if (calls === 3) return null as unknown as Promise<TicketSnapshot>;
    return Promise.resolve(snapshot("test", clock.now()));
  };
  const poll = startTrackerPoll({
    intervalMs: 2000,
    read,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });

  clock.advance(2000);
  await flush();
  const first = poll.getSnapshot();
  assert.ok(first);

  assert.doesNotThrow(() => clock.advance(2000));
  await flush();
  const thrown = poll.getSnapshot();
  assert.ok(thrown);
  assert.equal(thrown.capturedAt, first.capturedAt);
  assert.equal(thrown.reason, "unknown error");

  assert.doesNotThrow(() => clock.advance(2000));
  await flush();
  const malformed = poll.getSnapshot();
  assert.ok(malformed);
  assert.equal(malformed.capturedAt, first.capturedAt);
  assert.equal(malformed.reason, "invalid snapshot");
  poll.stop();
});

// ── PI-36: wiring the poll to the belowEditor issue list ──

function fakeEmitPi(emitted: unknown[]) {
  return {
    events: {
      on() {
        return () => {};
      },
      emit(channel: string, value: unknown) {
        if (channel === TICKET_SNAPSHOT_CHANNEL) emitted.push(value);
      },
    },
  };
}

test("PI-36: startTrackerPolling emits each completed snapshot on the ticket channel", async () => {
  const clock = fakeTimer();
  const emitted: unknown[] = [];
  const poll = startTrackerPolling(
    fakeEmitPi(emitted) as never,
    { workflow: { trackerPollMs: 500 } },
    "/repo",
    {
      read: async () => ({
        repo: "repo",
        capturedAt: clock.now(),
        records: [record("repo", "PI-36")],
      }),
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    },
  );
  // Below the [2000, 300000] clamp the interval resolves to 2000 (INV-13).
  assert.equal(clock.delays[0], 2000);
  clock.advance(2000);
  await flush();
  await flush();
  assert.equal(emitted.length, 1, "first completed read publishes");
  const snap = emitted[0] as {
    repo: string;
    capturedAt: number;
    records: readonly { id: string }[];
  };
  assert.equal(snap.repo, "repo");
  assert.equal(snap.records.length, 1);
  assert.equal(snap.records[0].id, "PI-36");

  clock.advance(2000);
  await flush();
  await flush();
  assert.equal(emitted.length, 2, "each completed read publishes");
  poll.stop();
  clock.advance(10_000);
  await flush();
  assert.equal(emitted.length, 2, "no snapshot published after stop");
});

test("PI-36: absent trackerPollMs defaults to 10000; failed reads publish a reasoned snapshot", async () => {
  const clock = fakeTimer();
  const emitted: unknown[] = [];
  const poll = startTrackerPolling(fakeEmitPi(emitted) as never, {}, "/repo", {
    read: async () => {
      throw new Error("repo missing");
    },
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  assert.equal(clock.delays[0], 10000, "absent interval uses the default");
  clock.advance(10000);
  await flush();
  await flush();
  assert.equal(emitted.length, 1);
  const snap = emitted[0] as { reason?: string; records: readonly unknown[] };
  assert.equal(snap.reason, "repo missing");
  assert.deepEqual(snap.records, []);
  poll.stop();
});

test("PI-36: readTrackerSnapshotForPoll maps the bounded tracker read off the render path", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi36-"));
  try {
    writeFileSync(
      join(dir, "tickets.md"),
      "## PI-36 — Wire the tracker poll to the belowEditor issue list\nStatus: **Agent Ready** · Blocked-by: none\n",
    );
    const snap = await readTrackerSnapshotForPoll(dir);
    assert.equal(snap.repo, basename(dir));
    assert.equal(snap.records.length, 1);
    assert.equal(snap.records[0].id, "PI-36");
    assert.equal(snap.records[0].status, "agent-ready");

    const missing = await readTrackerSnapshotForPoll(join(dir, "nope"));
    assert.equal(missing.reason, "no tracker");
    assert.deepEqual(missing.records, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tracker poll: stop clears scheduled timers and prevents further reads", async () => {
  const clock = fakeTimer();
  let readCount = 0;
  let release: (() => void) | undefined;
  const read = () => {
    readCount++;
    return new Promise<TicketSnapshot>((resolve) => {
      release = () => resolve(snapshot("test", clock.now()));
    });
  };
  const poll = startTrackerPoll({
    intervalMs: 2000,
    read,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  clock.advance(2000);
  await flush();
  assert.equal(readCount, 1);
  assert.ok(clock.unrefCount() >= 3);
  poll.stop();
  assert.equal(clock.pendingCount(), 0, "timers leaked after stop");
  release?.();
  await flush();
  clock.advance(20_000);
  await flush();
  assert.equal(readCount, 1, "reads continued after stop");
  assert.ok(clock.clearCount() >= 2, "stop did not clear all timers");
});
