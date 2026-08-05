import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { RoutineDefinition } from "./routines-scheduler.ts";
import {
  DEFAULT_ROUTINE_INTERVAL_MS,
  MAX_ROUTINE_INTERVAL_MS,
  MIN_ROUTINE_INTERVAL_MS,
  startRoutineScheduler,
} from "./routines-scheduler.ts";

/**
 * Deterministic fake timer: callbacks are captured and fired manually, so
 * tests never sleep on wall-clock intervals. Models cancellation and unref
 * so stop() can prove no timers remain scheduled.
 */
function fakeTimer(start = 1_000_000) {
  let nextId = 1;
  const pending = new Map<number, { cb: () => void; dueAt: number }>();
  const delays: number[] = [];
  let clearCount = 0;
  let unrefCount = 0;
  let now = start;
  return {
    now: () => now,
    delays,
    pendingCount: () => pending.size,
    clearCount: () => clearCount,
    unrefCount: () => unrefCount,
    advance: (ms: number) => {
      const target = now + ms;
      let guard = 0;
      while (guard++ < 100_000) {
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

function routine(overrides: Partial<RoutineDefinition>): RoutineDefinition {
  return { name: "r", prompt: "p", ...overrides };
}

// ---- purity ----

test("routine scheduler: pure module — no fs/network/subprocess imports", () => {
  const source = readFileSync(
    new URL("./routines-scheduler.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /node:(fs|child_process|http|https|net)/);
  assert.doesNotMatch(source, /\b(writeFile|rename|exec|spawn)\s*\(/);
  assert.doesNotMatch(source, /git\s+(commit|push)/i);
});

// ---- interval clamp + cadence [60000, 604800000] ----

test("routine scheduler: interval clamps to [60000, 604800000] and fires at that cadence", async () => {
  const cases: [unknown, number][] = [
    [-1, MIN_ROUTINE_INTERVAL_MS],
    [0, MIN_ROUTINE_INTERVAL_MS],
    [30000, MIN_ROUTINE_INTERVAL_MS],
    [60000, MIN_ROUTINE_INTERVAL_MS],
    [120000, 120000],
    [604800000, MAX_ROUTINE_INTERVAL_MS],
    [1_000_000_000, MAX_ROUTINE_INTERVAL_MS],
    [Infinity, DEFAULT_ROUTINE_INTERVAL_MS],
    [NaN, DEFAULT_ROUTINE_INTERVAL_MS],
  ];
  for (const [input, expected] of cases) {
    const clock = fakeTimer();
    let fires = 0;
    const scheduler = startRoutineScheduler({
      routines: [routine({ name: "a", scheduleMs: input as number })],
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
      onDue: () => {
        fires++;
      },
    });
    clock.advance(expected);
    await flush();
    assert.equal(fires, 1, `input ${input} should fire once at ${expected}ms`);
    clock.advance(expected);
    await flush();
    assert.equal(
      fires,
      2,
      `input ${input} should fire again after ${expected}ms`,
    );
    scheduler.stop();
  }
});

// ---- missing schedule never fires ----

test("routine scheduler: missing scheduleMs and no at never fires", async () => {
  const clock = fakeTimer();
  let fires = 0;
  const scheduler = startRoutineScheduler({
    routines: [routine({ name: "a" })],
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onDue: () => {
      fires++;
    },
  });
  for (let i = 0; i < 10; i++) {
    clock.advance(10000);
    await flush();
  }
  assert.equal(fires, 0);
  assert.deepEqual(scheduler.getDueRoutineNames(), []);
  const snap = scheduler.getSnapshot();
  assert.equal(
    snap.routines[0]?.configError,
    "missing schedule (set scheduleMs or at)",
  );
  scheduler.stop();
});

// ---- null scheduleMs treated as missing ----

test("routine scheduler: null scheduleMs is treated as missing, not as a 10s interval", async () => {
  const clock = fakeTimer(new Date(2026, 0, 1, 8, 59).getTime());
  const fires: string[] = [];
  const scheduler = startRoutineScheduler({
    routines: [
      routine({
        name: "null-ms",
        scheduleMs: null as unknown as number,
        at: [540],
      }),
      routine({ name: "bad", scheduleMs: null as unknown as number }),
    ],
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onDue: (r) => {
      fires.push(r.name);
    },
  });
  clock.advance(60 * 1000); // 09:00
  await flush();
  assert.deepEqual(
    fires,
    ["null-ms"],
    "null scheduleMs with at should fire at at minute",
  );
  const snap = scheduler.getSnapshot();
  assert.equal(
    snap.routines.find((s) => s.name === "bad")?.configError,
    "missing schedule (set scheduleMs or at)",
  );
  scheduler.stop();
});

// ---- at list: matching minute, once per minute, wrapping ----

test("routine scheduler: at list fires at matching minute, once per minute", async () => {
  const clock = fakeTimer(new Date(2026, 0, 1, 0, 0).getTime());
  const fires: string[] = [];
  // Use two routines with intervals that produce a sub-minute tick (gcd=6000)
  // so the once-per-minute guard is exercised.
  const scheduler = startRoutineScheduler({
    routines: [
      routine({ name: "daily", at: [9] }),
      routine({ name: "tick", scheduleMs: 60000 }),
      routine({ name: "sub", scheduleMs: 66000 }), // gcd(60000, 66000) = 6000
    ],
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onDue: (r) => {
      if (r.name === "daily") fires.push(r.name);
    },
  });

  // advance to 09:00:00
  clock.advance(9 * 60 * 60 * 1000);
  await flush();
  assert.equal(
    fires.filter((n) => n === "daily").length,
    1,
    "daily should fire once at 09:00",
  );

  // sub-minute ticks within the same minute → no second fire
  clock.advance(6 * 1000);
  await flush();
  assert.equal(
    fires.filter((n) => n === "daily").length,
    1,
    "daily should not fire again in same minute",
  );

  // advance to 09:10 (different minute, not in at list)
  clock.advance(10 * 60 * 1000);
  await flush();
  assert.equal(
    fires.filter((n) => n === "daily").length,
    1,
    "daily should not fire at 09:10",
  );

  scheduler.stop();
});

test("routine scheduler: at list wrapping across midnight", async () => {
  const clock = fakeTimer(new Date(2026, 0, 1, 23, 0).getTime());
  const fires: string[] = [];
  const scheduler = startRoutineScheduler({
    routines: [routine({ name: "edge", at: [1439, 1] })],
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onDue: (r) => {
      fires.push(r.name);
    },
  });

  // advance to 23:59 (first fire at minute 1439)
  clock.advance(59 * 60 * 1000);
  await flush();
  assert.equal(fires.length, 1, "should fire at 23:59");

  // advance to next day 00:01 (second fire at minute 1)
  clock.advance(2 * 60 * 1000);
  await flush();
  assert.equal(fires.length, 2, "should fire at 00:01");

  scheduler.stop();
});

test("routine scheduler: at boundary 0 fires at midnight", async () => {
  const clock = fakeTimer(new Date(2026, 0, 1, 23, 58).getTime());
  const fires: string[] = [];
  const scheduler = startRoutineScheduler({
    routines: [routine({ name: "midnight", at: [0] })],
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onDue: (r) => {
      fires.push(r.name);
    },
  });
  clock.advance(60 * 1000); // 23:59 → no fire
  await flush();
  assert.equal(fires.length, 0, "no fire at 23:59");
  clock.advance(60 * 1000); // 00:00
  await flush();
  assert.equal(fires.length, 1, "should fire at 00:00");
  scheduler.stop();
});

// ---- at + scheduleMs: spec precedence (at pins first fire, then interval drives) ----

test("routine scheduler: both at and scheduleMs — at pins first fire, then interval drives (spec q1)", async () => {
  const clock = fakeTimer(new Date(2026, 0, 1, 9, 30).getTime());
  const fires: string[] = [];
  const scheduler = startRoutineScheduler({
    // scheduleMs=3600000, at=[540] — next at 540 is tomorrow 09:00
    routines: [routine({ name: "both", scheduleMs: 3600000, at: [540] })],
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onDue: (r) => {
      fires.push(`[${r.name}@${clock.now()}]`);
    },
  });

  // 09:30 + 1h = 10:30: interval has elapsed but at has not matched → no fire
  clock.advance(60 * 60 * 1000);
  await flush();
  assert.equal(
    fires.length,
    0,
    "interval must not fire before the first at alignment",
  );

  // advance to next day 09:00 (minute 540): first fire via at
  clock.advance(22.5 * 60 * 60 * 1000);
  await flush();
  assert.equal(
    fires.length,
    1,
    "first fire should align to the next at minute",
  );

  // +1h: interval fires from the at anchor
  clock.advance(60 * 60 * 1000);
  await flush();
  assert.equal(
    fires.length,
    2,
    "subsequent fires use the interval from the anchor",
  );

  scheduler.stop();
});

// ---- invalid at values are dropped ----

test("routine scheduler: at values outside 0-1439 or non-integer are dropped", async () => {
  const clock = fakeTimer(new Date(2026, 0, 1, 8, 59).getTime());
  let fires = 0;
  const scheduler = startRoutineScheduler({
    routines: [routine({ name: "bad-at", at: [1440, -5, 1.5, 540] })],
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onDue: () => {
      fires++;
    },
  });
  clock.advance(60 * 1000); // 09:00 — only valid minute 540 remains
  await flush();
  assert.equal(fires, 1, "only the valid at value should fire");
  scheduler.stop();
});

test("routine scheduler: at with only invalid values and no scheduleMs is a config error", async () => {
  const clock = fakeTimer();
  const scheduler = startRoutineScheduler({
    routines: [routine({ name: "none", at: [1440, -5, 1.5] })],
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  clock.advance(60000);
  const snap = scheduler.getSnapshot();
  assert.equal(
    snap.routines[0]?.configError,
    "missing schedule (set scheduleMs or at)",
  );
  scheduler.stop();
});

// ---- empty at array with scheduleMs is interval-only ----

test("routine scheduler: empty at array with scheduleMs is interval-only", async () => {
  const clock = fakeTimer();
  let fires = 0;
  const scheduler = startRoutineScheduler({
    routines: [routine({ name: "empty", at: [], scheduleMs: 60000 })],
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onDue: () => {
      fires++;
    },
  });
  clock.advance(60 * 1000);
  await flush();
  assert.equal(
    fires,
    1,
    "empty at array + scheduleMs behaves as interval-only",
  );
  scheduler.stop();
});

// ---- two intervals: expected counts (tickets.md AC) ----

test("routine scheduler: intervals 60000 and 120000 fire 2 and 1 over 120000 ms", async () => {
  const clock = fakeTimer();
  const counts: Record<string, number> = { a: 0, b: 0 };
  const scheduler = startRoutineScheduler({
    routines: [
      routine({ name: "a", scheduleMs: 60000 }),
      routine({ name: "b", scheduleMs: 120000 }),
    ],
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onDue: (r) => {
      counts[r.name]++;
    },
  });

  for (let i = 0; i < 2; i++) {
    clock.advance(60000);
    await flush();
  }
  assert.equal(counts.a, 2);
  assert.equal(counts.b, 1);
  scheduler.stop();
});

// ---- single-flight ----

test("routine scheduler: slow handler never overlaps itself", async () => {
  const clock = fakeTimer();
  let active = 0;
  let maxActive = 0;
  let release: (() => void) | undefined;
  const scheduler = startRoutineScheduler({
    routines: [routine({ name: "a", scheduleMs: 60000 })],
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onDue: () => {
      active++;
      maxActive = Math.max(maxActive, active);
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    },
  });

  for (let i = 0; i < 10; i++) {
    clock.advance(60000);
    await flush();
  }
  assert.equal(active, 1);
  assert.equal(maxActive, 1, "overlapping fire started");
  release?.();
  await flush();
  scheduler.stop();
});

// ---- per-routine isolation ----

test("routine scheduler: throwing routine A never kills scheduler or routine B", async () => {
  const clock = fakeTimer();
  let bFires = 0;
  const scheduler = startRoutineScheduler({
    routines: [
      routine({ name: "a", scheduleMs: 60000 }),
      routine({ name: "b", scheduleMs: 60000 }),
    ],
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onDue: (r) => {
      if (r.name === "a") throw new Error("boom");
      bFires++;
    },
  });

  for (let i = 0; i < 5; i++) {
    assert.doesNotThrow(() => clock.advance(60000));
    await flush();
  }
  assert.equal(bFires, 5, "routine B should fire every tick");
  const snap = scheduler.getSnapshot();
  const aState = snap.routines.find((s) => s.name === "a");
  assert.equal(aState?.lastError, "boom");
  const bState = snap.routines.find((s) => s.name === "b");
  assert.equal(bState?.lastError, undefined);
  scheduler.stop();
});

// ---- stop ----

test("routine scheduler: stop clears timers and prevents further fires", async () => {
  const clock = fakeTimer();
  let fireCalls = 0;
  let release: (() => void) | undefined;
  const scheduler = startRoutineScheduler({
    routines: [routine({ name: "a", scheduleMs: 60000 })],
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onDue: () => {
      fireCalls++;
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    },
  });

  clock.advance(60000);
  await flush();
  assert.equal(fireCalls, 1);
  assert.ok(clock.unrefCount() >= 1, "timer should be unref'd");
  scheduler.stop();
  assert.equal(clock.pendingCount(), 0, "timers leaked after stop");
  assert.ok(clock.clearCount() >= 1, "stop did not clear timers");
  release?.();
  await flush();

  for (let i = 0; i < 10; i++) {
    clock.advance(60000);
    await flush();
  }
  assert.equal(fireCalls, 1, "fires continued after stop");
  scheduler.stop();
});

// ---- no routines ----

test("routine scheduler: with no routines the timer never fires", async () => {
  const clock = fakeTimer();
  let fires = 0;
  const scheduler = startRoutineScheduler({
    routines: [],
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onDue: () => {
      fires++;
    },
  });
  assert.equal(
    clock.pendingCount(),
    0,
    "no timer scheduled with zero routines",
  );
  clock.advance(100_000);
  await flush();
  assert.equal(fires, 0);
  assert.equal(scheduler.getSnapshot().tickCount, 0);
  scheduler.stop();
});

// ---- all-disabled or all-invalid → no timer ----

test("routine scheduler: with only disabled or invalid routines no timer is scheduled", async () => {
  const clock = fakeTimer();
  const scheduler = startRoutineScheduler({
    routines: [
      routine({ name: "d", scheduleMs: 60000, enabled: false }),
      routine({ name: "x", prompt: "" }),
    ],
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  assert.equal(clock.pendingCount(), 0, "no timer with nothing fire-able");
  clock.advance(60000);
  assert.equal(scheduler.getSnapshot().tickCount, 0);
  scheduler.stop();
});

// ---- determinism ----

test("routine scheduler: same input and now-sequence produce identical fire history", async () => {
  const run = async () => {
    const clock = fakeTimer(new Date(2026, 0, 1, 8, 0).getTime());
    const history: string[] = [];
    const scheduler = startRoutineScheduler({
      routines: [
        routine({ name: "hourly", scheduleMs: 3600000 }),
        routine({ name: "standup", at: [540] }),
        routine({ name: "tick", scheduleMs: 60000 }),
      ],
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
      onDue: (r) => {
        history.push(`[${r.name}@${clock.now()}]`);
      },
    });

    // 8 one-minute ticks → 08:08
    for (let i = 0; i < 8; i++) {
      clock.advance(60000);
      await flush();
    }
    // 61 one-minute ticks → crosses 09:00, standup fires
    for (let i = 0; i < 61; i++) {
      clock.advance(60000);
      await flush();
    }
    scheduler.stop();
    return history;
  };

  const first = await run();
  const second = await run();
  assert.deepEqual(first, second);
});

// ---- disabled + snoozed ----

test("routine scheduler: disabled and snoozed routines never appear as due", async () => {
  const clock = fakeTimer(new Date(2026, 0, 1, 8, 59).getTime());
  let fires = 0;
  const scheduler = startRoutineScheduler({
    routines: [
      routine({ name: "disabled", at: [540], enabled: false }),
      routine({
        name: "snoozed",
        at: [540],
        snoozedUntil: new Date(2026, 0, 1, 10, 0).getTime(),
      }),
      routine({ name: "active", at: [540] }),
    ],
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onDue: () => {
      fires++;
    },
  });

  clock.advance(60 * 1000); // 09:00
  await flush();
  assert.deepEqual(scheduler.getDueRoutineNames(), ["active"]);
  assert.equal(fires, 1);
  const snap = scheduler.getSnapshot();
  assert.equal(snap.routines.find((s) => s.name === "disabled")?.isDue, false);
  assert.equal(snap.routines.find((s) => s.name === "snoozed")?.isDue, false);
  assert.equal(snap.routines.find((s) => s.name === "active")?.isDue, true);
  scheduler.stop();
});

// ---- duplicate names + malformed defs ----

test("routine scheduler: duplicate names and malformed defs are isolated", async () => {
  const clock = fakeTimer();
  let fires = 0;
  const scheduler = startRoutineScheduler({
    routines: [
      routine({ name: "a", scheduleMs: 60000 }),
      routine({ name: "a", scheduleMs: 60000 }),
      routine({ name: "", prompt: "p", scheduleMs: 60000 }),
      routine({ name: "no-prompt", scheduleMs: 60000, prompt: "" }),
      null as unknown as RoutineDefinition,
    ],
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onDue: () => {
      fires++;
    },
  });
  clock.advance(60000);
  await flush();
  assert.equal(fires, 1, "only the first valid routine fires");
  const snap = scheduler.getSnapshot();
  const reasons = snap.routines.map((r) => r.configError ?? "ok");
  assert.deepEqual(reasons, [
    "ok",
    "duplicate name",
    "invalid name",
    "missing prompt",
    "invalid definition",
  ]);
  scheduler.stop();
});

// ---- INV-6: throwing now / setTimer ----

test("routine scheduler: throwing injected now() stops the scheduler (INV-6)", () => {
  const clock = fakeTimer();
  let calls = 0;
  const now = () => {
    if (++calls > 1) throw new Error("clock failed");
    return clock.now();
  };
  const scheduler = startRoutineScheduler({
    routines: [routine({ name: "a", scheduleMs: 60000 })],
    now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onDue: () => {},
  });
  assert.doesNotThrow(() => clock.advance(60000));
  assert.doesNotThrow(() => scheduler.stop());
  scheduler.stop();
});

test("routine scheduler: throwing injected setTimer() stops the scheduler (INV-6)", () => {
  const clock = fakeTimer();
  let setCalls = 0;
  const setTimer = (cb: () => void, delayMs: number): NodeJS.Timeout => {
    setCalls++;
    if (setCalls > 1) throw new Error("timer failed");
    return clock.setTimer(cb, delayMs);
  };
  const scheduler = startRoutineScheduler({
    routines: [routine({ name: "a", scheduleMs: 60000 })],
    now: clock.now,
    setTimer,
    clearTimer: clock.clearTimer,
    onDue: () => {},
  });
  assert.doesNotThrow(() => clock.advance(60000));
  assert.doesNotThrow(() => scheduler.stop());
  scheduler.stop();
});

// ---- perf: 10 000 steps ----

test("routine scheduler: 10 000 ticks complete in under 2 000 ms", () => {
  const clock = fakeTimer();
  const scheduler = startRoutineScheduler({
    routines: [routine({ name: "a", scheduleMs: 60000 })],
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });

  const started = performance.now();
  for (let i = 0; i < 10_000; i++) clock.advance(60000);
  const elapsed = performance.now() - started;
  assert.equal(scheduler.getSnapshot().tickCount, 10_000);
  assert.ok(
    elapsed < 2000,
    `10 000 ticks took ${elapsed}ms, expected < 2000ms`,
  );
  scheduler.stop();
});
