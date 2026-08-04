import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  buildReading,
  isStale,
  type ProgressReading,
  STALE_AFTER_MS,
  type ReadingInput,
} from "./stage-progress.ts";

test("total of 0, null, undefined, or NaN yields indeterminate, never a percent", () => {
  for (const total of [0, null, undefined, Number.NaN]) {
    const reading = buildReading({
      source: "context",
      done: 3,
      total: total as number | null | undefined,
      at: 1_000,
      elapsedMs: 500,
      turns: 2,
    });
    assert.equal(reading.kind, "indeterminate");
    assert.ok(!("percent" in reading));
    assert.equal(reading.at, 1_000);
  }
});

test("a negative or non-finite total also degrades to indeterminate", () => {
  for (const total of [-1, -0, Number.POSITIVE_INFINITY]) {
    assert.equal(
      buildReading({ source: "stage", done: 1, total, at: 0 }).kind,
      "indeterminate",
    );
  }
});

test("non-finite done, total, or at never produces a malformed percent reading", () => {
  for (const done of [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ]) {
    const reading = buildReading({
      source: "context",
      done,
      total: 2,
      at: 1_000,
    });
    assert.equal(reading.kind, "indeterminate");
    assert.ok(!("percent" in reading));
  }
  for (const total of [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ]) {
    const reading = buildReading({
      source: "context",
      done: 1,
      total,
      at: 1_000,
    });
    assert.equal(reading.kind, "indeterminate");
    assert.ok(!("percent" in reading));
  }
  for (const at of [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ]) {
    const reading = buildReading({
      source: "context",
      done: 1,
      total: 2,
      at,
    });
    assert.equal(reading.kind, "indeterminate");
    assert.ok(!("percent" in reading));
    assert.equal(reading.at, 0);
  }
});

test("a source outside context|questions|stage throws — tickets included", () => {
  for (const source of ["tickets", "tracker", "", "estimate"]) {
    assert.throws(() =>
      buildReading({ source: source as "context", done: 1, total: 2, at: 0 }),
    );
  }
});

test("invalid runtime containers degrade without throwing", () => {
  for (const input of [null, undefined, 42, "not an input", true]) {
    const reading = buildReading(input as unknown as ReadingInput);
    assert.deepEqual(reading, {
      kind: "indeterminate",
      elapsedMs: 0,
      turns: 0,
      at: 0,
    });
  }
  for (const input of [
    {},
    { source: null },
    { source: "tickets", done: 1, total: 2, at: 0 },
  ]) {
    assert.throws(() => buildReading(input as unknown as ReadingInput));
  }
});

test("the three allowed sources build without throwing", () => {
  for (const source of ["context", "questions", "stage"] as const) {
    const reading = buildReading({ source, done: 1, total: 4, at: 0 });
    assert.equal(reading.kind, "measured");
    if (reading.kind === "measured") assert.equal(reading.source, source);
  }
});

test("measured readings clamp percent to 0..100 and preserve exact done/total", () => {
  const over = buildReading({ source: "stage", done: 12, total: 8, at: 5 });
  assert.deepEqual(over, {
    kind: "measured",
    percent: 100,
    done: 12,
    total: 8,
    source: "stage",
    at: 5,
  });
  const under = buildReading({
    source: "questions",
    done: -3,
    total: 10,
    at: 7,
  });
  assert.deepEqual(under, {
    kind: "measured",
    percent: 0,
    done: -3,
    total: 10,
    source: "questions",
    at: 7,
  });
  const exact = buildReading({ source: "context", done: 1, total: 3, at: 9 });
  if (exact.kind !== "measured") assert.fail("expected measured");
  assert.ok(Math.abs(exact.percent - 100 / 3) < 1e-9);
});

test("indeterminate readings carry elapsedMs and turns, no percent", () => {
  const reading = buildReading({
    source: "stage",
    done: 0,
    total: 0,
    at: 42,
    elapsedMs: 61_000,
    turns: 7,
  });
  assert.deepEqual(reading, {
    kind: "indeterminate",
    elapsedMs: 61_000,
    turns: 7,
    at: 42,
  });
});

test("malformed elapsedMs and turns degrade to safe counters", () => {
  const reading = buildReading({
    source: "stage",
    done: 0,
    total: 0,
    at: 42,
    elapsedMs: Number.NaN,
    turns: -1,
  });
  assert.deepEqual(reading, {
    kind: "indeterminate",
    elapsedMs: 0,
    turns: 0,
    at: 42,
  });
});

test("isStale is exactly false at 30000ms and true at 30001ms", () => {
  assert.equal(STALE_AFTER_MS, 30_000);
  const now = 100_000;
  const fresh = buildReading({
    source: "stage",
    done: 1,
    total: 2,
    at: now - 30_000,
  });
  const stale = buildReading({
    source: "stage",
    done: 1,
    total: 2,
    at: now - 30_001,
  });
  assert.equal(isStale(fresh, now), false);
  assert.equal(isStale(stale, now), true);
  const indeterminate = buildReading({
    source: "stage",
    done: 0,
    total: 0,
    at: now - 30_001,
  });
  assert.equal(isStale(indeterminate, now), true);
});

test("future timestamps are not stale, but malformed clocks and readings are stale", () => {
  const now = 100_000;
  const future = buildReading({
    source: "stage",
    done: 1,
    total: 2,
    at: now + 1,
  });
  assert.equal(isStale(future, now), false);

  for (const invalidNow of [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ]) {
    assert.equal(isStale(future, invalidNow), true);
  }
  for (const invalidReading of [
    null,
    undefined,
    {},
    { kind: "measured", percent: 50, at: Number.NaN },
    { kind: "unknown", at: now },
  ]) {
    assert.equal(
      isStale(invalidReading as unknown as ProgressReading, now),
      true,
    );
  }
});

test("buildReading is non-mutating and returns an immutable reading", () => {
  const input = Object.freeze({
    source: "stage" as const,
    done: 1,
    total: 2,
    at: 42,
  });
  const reading = buildReading(input);
  assert.deepEqual(input, {
    source: "stage",
    done: 1,
    total: 2,
    at: 42,
  });
  assert.equal(Object.isFrozen(reading), true);
  assert.equal(Reflect.set(reading, "percent", 99), false);
  if (reading.kind === "measured") assert.equal(reading.percent, 50);
});

test("the module imports no fs, subprocess, or network APIs", () => {
  const source = readFileSync(
    new URL("./stage-progress.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /from\s+["']node:(fs|child_process|http|https|net)/,
  );
  assert.doesNotMatch(source, /\b(fetch|XMLHttpRequest|WebSocket)\s*\(/);
});
