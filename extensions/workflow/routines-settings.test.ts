import assert from "node:assert/strict";
import test from "node:test";
import { readRoutines, writeRoutines } from "./routines-settings.ts";
import type { RoutineDefinition } from "./routines-settings.ts";

// ─── read: missing key ───────────────────────────────────────────────

test("readRoutines on missing key returns empty array with no warnings", () => {
  const { routines, warnings } = readRoutines({});
  assert.equal(routines.length, 0);
  assert.equal(warnings.length, 0);
});

test("readRoutines on missing workflow key returns empty array", () => {
  const { routines, warnings } = readRoutines({ theme: "vraj-ink" });
  assert.equal(routines.length, 0);
  assert.equal(warnings.length, 0);
});

test("readRoutines on non-object workflow returns empty array", () => {
  const { routines, warnings } = readRoutines({ workflow: "hello" });
  assert.equal(routines.length, 0);
  assert.equal(warnings.length, 0);
});

test("readRoutines on non-array routines returns empty array", () => {
  const { routines, warnings } = readRoutines({
    workflow: { routines: "not-an-array" },
  });
  assert.equal(routines.length, 0);
  assert.equal(warnings.length, 0);
});

test("readRoutines on null settings returns empty array", () => {
  // @ts-expect-error — testing runtime guard
  const { routines, warnings } = readRoutines(null);
  assert.equal(routines.length, 0);
  assert.equal(warnings.length, 0);
});

// ─── read: per-entry validation ──────────────────────────────────────

test("readRoutines drops malformed entries per-entry, keeps valid siblings", () => {
  const settings = {
    workflow: {
      routines: [
        null,
        { name: "valid", scheduleMs: 60000, prompt: "hello" },
        "string-entry",
        { name: "valid2", scheduleMs: 120000, prompt: "world" },
        42,
      ],
    },
  };
  const { routines, warnings } = readRoutines(settings);
  assert.equal(routines.length, 2);
  assert.equal(routines[0].name, "valid");
  assert.equal(routines[1].name, "valid2");
  assert.equal(warnings.length, 3);
});

test("readRoutines rejects entry with missing name", () => {
  const settings = {
    workflow: {
      routines: [{ scheduleMs: 60000, prompt: "hello" }],
    },
  };
  const { routines, warnings } = readRoutines(settings);
  assert.equal(routines.length, 0);
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].includes("invalid name"));
});

test("readRoutines rejects entry with empty name", () => {
  const settings = {
    workflow: {
      routines: [{ name: "", scheduleMs: 60000, prompt: "hello" }],
    },
  };
  const { routines, warnings } = readRoutines(settings);
  assert.equal(routines.length, 0);
  assert.equal(warnings.length, 1);
});

test("readRoutines rejects entry with non-number scheduleMs", () => {
  const settings = {
    workflow: {
      routines: [
        { name: "bad", scheduleMs: "60000", prompt: "hello" },
        { name: "good", scheduleMs: 60000, prompt: "world" },
      ],
    },
  };
  const { routines, warnings } = readRoutines(settings);
  assert.equal(routines.length, 1);
  assert.equal(routines[0].name, "good");
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].includes("invalid scheduleMs"));
});

// ─── name validation: dangerous characters ───────────────────────────

test("readRoutines rejects name with spaces", () => {
  const settings = {
    workflow: {
      routines: [{ name: "bad name", scheduleMs: 60000, prompt: "hello" }],
    },
  };
  const { routines, warnings } = readRoutines(settings);
  assert.equal(routines.length, 0);
  assert.equal(warnings.length, 1);
});

test("readRoutines rejects name with shell metacharacters", () => {
  const settings = {
    workflow: {
      routines: [
        { name: "test;rm -rf", scheduleMs: 60000, prompt: "hello" },
        { name: "backtick`cmd`", scheduleMs: 60000, prompt: "hello" },
        { name: "dollar$HOME", scheduleMs: 60000, prompt: "hello" },
        { name: "pipe|cat", scheduleMs: 60000, prompt: "hello" },
        { name: "quote'bad", scheduleMs: 60000, prompt: "hello" },
      ],
    },
  };
  const { routines, warnings } = readRoutines(settings);
  assert.equal(routines.length, 0);
  assert.equal(warnings.length, 5);
});

test("readRoutines rejects name over 40 characters", () => {
  const settings = {
    workflow: {
      routines: [
        {
          name: "a".repeat(41),
          scheduleMs: 60000,
          prompt: "hello",
        },
      ],
    },
  };
  const { routines, warnings } = readRoutines(settings);
  assert.equal(routines.length, 0);
  assert.equal(warnings.length, 1);
});

test("readRoutines accepts name of exactly 40 characters", () => {
  const settings = {
    workflow: {
      routines: [
        {
          name: "a".repeat(40),
          scheduleMs: 60000,
          prompt: "hello",
        },
      ],
    },
  };
  const { routines, warnings } = readRoutines(settings);
  assert.equal(routines.length, 1);
  assert.equal(warnings.length, 0);
});

test("readRoutines accepts valid names with hyphens, dots, underscores", () => {
  const settings = {
    workflow: {
      routines: [
        { name: "daily-standup", scheduleMs: 60000, prompt: "p" },
        { name: "weekly.review", scheduleMs: 60000, prompt: "p" },
        { name: "hourly_check", scheduleMs: 60000, prompt: "p" },
        { name: "Routine-1.0_test", scheduleMs: 60000, prompt: "p" },
      ],
    },
  };
  const { routines, warnings } = readRoutines(settings);
  assert.equal(routines.length, 4);
  assert.equal(warnings.length, 0);
});

test("readRoutines clamps zero scheduleMs to 60000", () => {
  const settings = {
    workflow: {
      routines: [{ name: "zero", scheduleMs: 0, prompt: "hello" }],
    },
  };
  const { routines, warnings } = readRoutines(settings);
  assert.equal(routines.length, 1);
  assert.equal(routines[0].scheduleMs, 60000);
  assert.equal(warnings.length, 0);
});

test("readRoutines clamps negative scheduleMs to 60000", () => {
  const settings = {
    workflow: {
      routines: [{ name: "neg", scheduleMs: -1000, prompt: "hello" }],
    },
  };
  const { routines, warnings } = readRoutines(settings);
  assert.equal(routines.length, 1);
  assert.equal(routines[0].scheduleMs, 60000);
  assert.equal(warnings.length, 0);
});

test("readRoutines rejects non-finite scheduleMs", () => {
  const settings = {
    workflow: {
      routines: [
        { name: "nan", scheduleMs: NaN, prompt: "hello" },
        { name: "inf", scheduleMs: Infinity, prompt: "world" },
      ],
    },
  };
  const { routines, warnings } = readRoutines(settings);
  assert.equal(routines.length, 0);
  assert.equal(warnings.length, 2);
  assert.ok(warnings.every((w) => w.includes("invalid scheduleMs")));
});

test("readRoutines clamps scheduleMs above max to 604800000", () => {
  const settings = {
    workflow: {
      routines: [{ name: "big", scheduleMs: 1_000_000_000, prompt: "hello" }],
    },
  };
  const { routines, warnings } = readRoutines(settings);
  assert.equal(routines.length, 1);
  assert.equal(routines[0].scheduleMs, 604800000);
  assert.equal(warnings.length, 0);
});

test("readRoutines keeps in-range scheduleMs unchanged", () => {
  const settings = {
    workflow: {
      routines: [
        { name: "a", scheduleMs: 60000, prompt: "p" },
        { name: "b", scheduleMs: 3600000, prompt: "p" },
        { name: "c", scheduleMs: 604800000, prompt: "p" },
      ],
    },
  };
  const { routines } = readRoutines(settings);
  assert.equal(routines.length, 3);
  assert.equal(routines[0].scheduleMs, 60000);
  assert.equal(routines[1].scheduleMs, 3600000);
  assert.equal(routines[2].scheduleMs, 604800000);
});

test("readRoutines rejects entry with missing prompt", () => {
  const settings = {
    workflow: {
      routines: [{ name: "noprompt", scheduleMs: 60000 }],
    },
  };
  const { routines, warnings } = readRoutines(settings);
  assert.equal(routines.length, 0);
  assert.equal(warnings.length, 1);
});

test("readRoutines rejects entry with empty prompt", () => {
  const settings = {
    workflow: {
      routines: [{ name: "empty", scheduleMs: 60000, prompt: "" }],
    },
  };
  const { routines, warnings } = readRoutines(settings);
  assert.equal(routines.length, 0);
  assert.equal(warnings.length, 1);
});

// ─── at validation ───────────────────────────────────────────────────

test("readRoutines drops entry when at is not an array", () => {
  const settings = {
    workflow: {
      routines: [
        { name: "bad", scheduleMs: 60000, at: "string", prompt: "hello" },
        { name: "good", scheduleMs: 60000, prompt: "world" },
      ],
    },
  };
  const { routines, warnings } = readRoutines(settings);
  assert.equal(routines.length, 1);
  assert.equal(routines[0].name, "good");
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].includes('invalid "at"'));
});

test("readRoutines silently drops invalid at values, keeps valid ones", () => {
  const settings = {
    workflow: {
      routines: [
        {
          name: "filtered",
          scheduleMs: 60000,
          at: [500, 9999, 700, -1, 1440, 0.5],
          prompt: "hello",
        },
      ],
    },
  };
  const { routines, warnings } = readRoutines(settings);
  assert.equal(routines.length, 1);
  assert.equal(routines[0].name, "filtered");
  assert.deepEqual(routines[0].at, [500, 700]);
  assert.equal(warnings.length, 0);
});

test("readRoutines deduplicates at values", () => {
  const settings = {
    workflow: {
      routines: [
        {
          name: "deduped",
          scheduleMs: 60000,
          at: [500, 500, 700, 500, 700],
          prompt: "hello",
        },
      ],
    },
  };
  const { routines, warnings } = readRoutines(settings);
  assert.equal(routines.length, 1);
  assert.deepEqual(routines[0].at, [500, 700]);
  assert.equal(warnings.length, 0);
});

test("readRoutines treats empty at after filtering as absent", () => {
  const settings = {
    workflow: {
      routines: [
        {
          name: "allbad",
          scheduleMs: 60000,
          at: [-1, 9999],
          prompt: "hello",
        },
      ],
    },
  };
  const { routines, warnings } = readRoutines(settings);
  assert.equal(routines.length, 1);
  assert.equal(routines[0].at, undefined);
  assert.equal(warnings.length, 0);
});

// ─── enabled default ─────────────────────────────────────────────────

test("readRoutines defaults enabled to true when absent", () => {
  const settings = {
    workflow: {
      routines: [{ name: "default", scheduleMs: 60000, prompt: "hello" }],
    },
  };
  const { routines } = readRoutines(settings);
  assert.equal(routines.length, 1);
  assert.equal(routines[0].enabled, true);
});

test("readRoutines passes through explicit enabled value", () => {
  const settings = {
    workflow: {
      routines: [
        {
          name: "disabled",
          scheduleMs: 60000,
          prompt: "hello",
          enabled: false,
        },
        { name: "enabled", scheduleMs: 60000, prompt: "world", enabled: true },
      ],
    },
  };
  const { routines } = readRoutines(settings);
  assert.equal(routines.length, 2);
  assert.equal(routines[0].enabled, false);
  assert.equal(routines[1].enabled, true);
});

// ─── snoozedUntil validation (bounce-1 fix) ───────────────────────────

test("readRoutines preserves valid snoozedUntil", () => {
  const settings = {
    workflow: {
      routines: [
        {
          name: "snoozed",
          scheduleMs: 60000,
          prompt: "hello",
          snoozedUntil: 1780000000000,
        },
      ],
    },
  };
  const { routines, warnings } = readRoutines(settings);
  assert.equal(routines.length, 1);
  assert.equal(routines[0].snoozedUntil, 1780000000000);
  assert.equal(warnings.length, 0);
});

test("readRoutines treats null snoozedUntil as undefined", () => {
  const settings = {
    workflow: {
      routines: [
        {
          name: "snoozed",
          scheduleMs: 60000,
          prompt: "hello",
          snoozedUntil: null,
        },
      ],
    },
  };
  const { routines, warnings } = readRoutines(settings);
  assert.equal(routines.length, 1);
  assert.equal(routines[0].snoozedUntil, undefined);
  assert.equal("snoozedUntil" in routines[0], false);
  assert.equal(warnings.length, 0);
});

test("readRoutines treats absent snoozedUntil as undefined", () => {
  const settings = {
    workflow: {
      routines: [{ name: "plain", scheduleMs: 60000, prompt: "hello" }],
    },
  };
  const { routines } = readRoutines(settings);
  assert.equal(routines.length, 1);
  assert.equal(routines[0].snoozedUntil, undefined);
  assert.equal("snoozedUntil" in routines[0], false);
});

test("readRoutines drops invalid snoozedUntil values with warning, keeps entry", () => {
  const settings = {
    workflow: {
      routines: [
        { name: "nan", scheduleMs: 60000, prompt: "one", snoozedUntil: NaN },
        {
          name: "inf",
          scheduleMs: 60000,
          prompt: "two",
          snoozedUntil: Infinity,
        },
        {
          name: "neg",
          scheduleMs: 60000,
          prompt: "three",
          snoozedUntil: -1000,
        },
        { name: "zero", scheduleMs: 60000, prompt: "four", snoozedUntil: 0 },
        {
          name: "str",
          scheduleMs: 60000,
          prompt: "five",
          snoozedUntil: "1780000000000",
        },
      ],
    },
  };
  const { routines, warnings } = readRoutines(settings);
  assert.equal(routines.length, 5);
  assert.equal(warnings.length, 5);
  assert.ok(warnings.every((w) => w.includes("invalid snoozedUntil")));
  for (const r of routines) {
    assert.equal("snoozedUntil" in r, false);
  }
});

test("readRoutines invalid snoozedUntil does not drop a valid sibling", () => {
  const settings = {
    workflow: {
      routines: [
        { name: "bad", scheduleMs: 60000, prompt: "one", snoozedUntil: "nope" },
        {
          name: "good",
          scheduleMs: 60000,
          prompt: "two",
          snoozedUntil: 1780000000000,
        },
      ],
    },
  };
  const { routines, warnings } = readRoutines(settings);
  assert.equal(routines.length, 2);
  assert.equal(routines[0].snoozedUntil, undefined);
  assert.equal(routines[1].snoozedUntil, 1780000000000);
  assert.equal(warnings.length, 1);
});

// ─── duplicates: first-wins (INV-16) ─────────────────────────────────

test("readRoutines first-wins on duplicate names", () => {
  const settings = {
    workflow: {
      routines: [
        { name: "dup", scheduleMs: 60000, prompt: "first" },
        { name: "dup", scheduleMs: 120000, prompt: "second" },
        { name: "other", scheduleMs: 30000, prompt: "third" },
      ],
    },
  };
  const { routines, warnings } = readRoutines(settings);
  assert.equal(routines.length, 2);
  assert.equal(routines[0].name, "dup");
  assert.equal(routines[0].scheduleMs, 60000);
  assert.equal(routines[0].prompt, "first");
  assert.equal(routines[1].name, "other");
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].includes("duplicate name"));
});

// ─── write: preserves unrelated keys (INV-10) ────────────────────────

test("writeRoutines preserves unrelated settings keys", () => {
  const settings = {
    theme: "vraj-ink",
    steeringMode: "one-at-a-time",
    workflow: { mode: "workflow", trackerPollMs: 10000 },
    packages: ["git:github.com/DietrichGebert/ponytail"],
  };
  const routines: RoutineDefinition[] = [
    {
      name: "standup",
      scheduleMs: 86400000,
      prompt: "daily standup",
      enabled: true,
    },
  ];
  const result = writeRoutines(routines, settings);
  assert.equal(result.ok, true);
  const saved = result.settings!;
  const wf = saved.workflow as Record<string, unknown>;
  assert.equal(saved.theme, "vraj-ink");
  assert.equal(saved.steeringMode, "one-at-a-time");
  assert.equal(wf.mode, "workflow");
  assert.equal(wf.trackerPollMs, 10000);
  assert.deepEqual(saved.packages, ["git:github.com/DietrichGebert/ponytail"]);
});

test("writeRoutines creates workflow object when absent", () => {
  const settings = { theme: "vraj-ink" };
  const routines: RoutineDefinition[] = [
    { name: "test", scheduleMs: 60000, prompt: "hello", enabled: true },
  ];
  const result = writeRoutines(routines, settings);
  assert.equal(result.ok, true);
  const saved = result.settings!;
  const wf = saved.workflow as Record<string, unknown>;
  assert.equal(saved.theme, "vraj-ink");
  assert.ok(Array.isArray(wf.routines));
  assert.equal((wf.routines as unknown[]).length, 1);
});

test("writeRoutines preserves existing workflow keys", () => {
  const settings = {
    workflow: { mode: "workflow", trackerPollMs: 10000 },
  };
  const routines: RoutineDefinition[] = [
    { name: "test", scheduleMs: 60000, prompt: "hello", enabled: true },
  ];
  const result = writeRoutines(routines, settings);
  assert.equal(result.ok, true);
  const saved = result.settings!;
  const wf = saved.workflow as Record<string, unknown>;
  assert.equal(wf.mode, "workflow");
  assert.equal(wf.trackerPollMs, 10000);
  assert.equal((wf.routines as unknown[]).length, 1);
});

// ─── write: failure ──────────────────────────────────────────────────

test("writeRoutines returns {ok: false} for non-object settings", () => {
  // @ts-expect-error — testing runtime guard
  let result = writeRoutines([], null);
  assert.equal(result.ok, false);
  assert.ok(result.reason);

  // @ts-expect-error — testing runtime guard
  result = writeRoutines([], "string");
  assert.equal(result.ok, false);
  assert.ok(result.reason);

  result = writeRoutines([], undefined as unknown as Record<string, unknown>);
  assert.equal(result.ok, false);
  assert.ok(result.reason);
});

// ─── round-trip ──────────────────────────────────────────────────────

test("writeRoutines then readRoutines returns same routines", () => {
  const settings = {
    theme: "vraj-ink",
    workflow: { mode: "workflow" },
  };
  const original: RoutineDefinition[] = [
    {
      name: "standup",
      scheduleMs: 86400000,
      at: [540],
      prompt: "daily standup",
      enabled: true,
      snoozedUntil: 1780000000000,
    },
    {
      name: "hourly",
      scheduleMs: 3600000,
      prompt: "hourly check",
      enabled: false,
    },
    {
      name: "weekly",
      scheduleMs: 604800000,
      prompt: "weekly review",
      enabled: true,
    },
  ];

  const writeResult = writeRoutines(original, settings);
  assert.equal(writeResult.ok, true);
  const { routines, warnings } = readRoutines(writeResult.settings!);
  assert.equal(warnings.length, 0);
  assert.equal(routines.length, original.length);

  for (let i = 0; i < original.length; i++) {
    assert.equal(routines[i].name, original[i].name);
    assert.equal(routines[i].scheduleMs, original[i].scheduleMs);
    assert.equal(routines[i].prompt, original[i].prompt);
    assert.equal(routines[i].enabled, original[i].enabled);
    if (original[i].at) {
      assert.deepEqual(routines[i].at, original[i].at);
    }
    if (original[i].snoozedUntil !== undefined) {
      assert.equal(routines[i].snoozedUntil, original[i].snoozedUntil);
    } else {
      assert.equal("snoozedUntil" in routines[i], false);
    }
  }
});

test("snoozedUntil survives read → write → read round-trip", () => {
  const settings = { workflow: { mode: "workflow" } };
  const original: RoutineDefinition[] = [
    {
      name: "snoozed",
      scheduleMs: 60000,
      prompt: "hello",
      enabled: true,
      snoozedUntil: 1780000000000,
    },
  ];

  const w1 = writeRoutines(original, settings);
  const { routines: r1 } = readRoutines(w1.settings!);
  assert.equal(r1[0].snoozedUntil, 1780000000000);

  const w2 = writeRoutines(r1 as RoutineDefinition[], settings);
  const { routines: r2 } = readRoutines(w2.settings!);
  assert.equal(r2[0].snoozedUntil, 1780000000000);
  assert.equal(r2.length, 1);
});

test("writeRoutines preserves snoozedUntil on output", () => {
  const settings = { workflow: { mode: "workflow" } };
  const routines: RoutineDefinition[] = [
    {
      name: "snoozed",
      scheduleMs: 60000,
      prompt: "hello",
      enabled: true,
      snoozedUntil: 1780000000000,
    },
  ];
  const result = writeRoutines(routines, settings);
  assert.equal(result.ok, true);
  const wf = result.settings!.workflow as Record<string, unknown>;
  const saved = (wf.routines as Record<string, unknown>[])[0];
  assert.equal(saved.snoozedUntil, 1780000000000);
});

test("writeRoutines is idempotent", () => {
  const settings = { workflow: { mode: "workflow" } };
  const routines: RoutineDefinition[] = [
    { name: "test", scheduleMs: 60000, prompt: "hello", enabled: true },
  ];

  const r1 = writeRoutines(routines, settings);
  const r2 = writeRoutines(routines, r1.settings!);
  assert.equal(r2.ok, true);
  assert.deepEqual(r2.settings, r1.settings);
});

// ─── INV-2: no secrets echoed ────────────────────────────────────────

test("readRoutines warnings never echo raw values", () => {
  const settings = {
    workflow: {
      routines: [
        { name: "api-key-12345", scheduleMs: "not-a-number", prompt: "check" },
        { name: "", scheduleMs: 60000, prompt: "secret" },
        { scheduleMs: 60000, prompt: "no-name" },
      ],
    },
  };
  const { warnings } = readRoutines(settings);
  assert.equal(warnings.length, 3);
  for (const w of warnings) {
    // Warnings should not contain the raw values
    assert.ok(!w.includes("api-key-12345"), `warning contains raw value: ${w}`);
    assert.ok(!w.includes("not-a-number"), `warning contains raw value: ${w}`);
  }
});

// ─── read path never throws (INV-6) ──────────────────────────────────

test("readRoutines never throws on any input", () => {
  const inputs: unknown[] = [
    null,
    undefined,
    "string",
    42,
    [],
    { workflow: null },
    { workflow: { routines: null } },
    { workflow: { routines: "string" } },
    { workflow: { routines: [null, undefined, "string", 42, {}] } },
    { workflow: { routines: [{ name: 42, scheduleMs: "bad", prompt: 42 }] } },
  ];

  for (const input of inputs) {
    const { routines, warnings } = readRoutines(
      input as Record<string, unknown>,
    );
    assert.ok(Array.isArray(routines));
    assert.ok(Array.isArray(warnings));
  }
});

test("readRoutines handles throwing workflow getter without crashing", () => {
  const settings = {
    get workflow() {
      throw new Error("boom");
    },
  };
  const { routines, warnings } = readRoutines(settings);
  assert.equal(routines.length, 0);
  assert.equal(warnings.length, 0);
});

test("readRoutines handles throwing routines getter without crashing", () => {
  const settings = {
    workflow: {
      get routines() {
        throw new Error("boom");
      },
    },
  };
  const { routines, warnings } = readRoutines(settings);
  assert.equal(routines.length, 0);
  assert.equal(warnings.length, 0);
});

// ─── perf: 10 000 entries ───────────────────────────────────────────

test("readRoutines handles 10 000 entries in under 500 ms", () => {
  const entries: Record<string, unknown>[] = [];
  for (let i = 0; i < 10_000; i++) {
    entries.push({
      name: `r${i}`,
      scheduleMs: 60000 + i,
      prompt: "hello",
    });
  }
  const settings = { workflow: { routines: entries } };
  const start = performance.now();
  const { routines, warnings } = readRoutines(settings);
  const elapsed = performance.now() - start;
  assert.equal(routines.length, 10_000);
  assert.equal(warnings.length, 0);
  assert.ok(
    elapsed < 500,
    `10 000 entries took ${elapsed}ms, expected < 500ms`,
  );
});

test("writeRoutines never throws on any input", () => {
  const inputs: unknown[] = [null, undefined, "string", 42];
  for (const input of inputs) {
    const result = writeRoutines([], input as Record<string, unknown>);
    assert.equal(result.ok, false);
    assert.ok(typeof result.reason === "string");
  }
});
