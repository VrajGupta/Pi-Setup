import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  buildReading,
  type ProgressReading,
} from "../shared/stage-progress.ts";
import type { WorkflowSubagentSummary } from "../shared/workflow-state.ts";
import { renderFooter, type FooterState } from "./footer.ts";

const plainTheme = { fg: (_color: string, text: string) => text };

function agent(overrides: Partial<WorkflowSubagentSummary> = {}) {
  return {
    id: "a1",
    title: "agent",
    status: "running" as const,
    backend: "pi" as const,
    startedAt: 1_000,
    turns: 3,
    ...overrides,
  };
}

function state(overrides: Partial<FooterState> = {}): FooterState {
  return {
    width: 80,
    theme: plainTheme,
    now: 10_000,
    cwdLabel: "~/repo",
    runtime: "pi/model · high · · part2",
    rail: "flow · part1 → ◉ part2 → · part3 → · part4",
    routeStatus: "fleet/part2 · running",
    usage: "42%/200k · $0.12 · 13 tok/s",
    pr: "main · 2 changed",
    agents: [],
    statuses: [],
    readingFor: () => buildReading({ source: "stage", at: 10_000 }),
    ...overrides,
  };
}

test("no tracked agents renders exactly the 3 base lines", () => {
  assert.equal(renderFooter(state()).length, 3);
});

test("2 stage agents render 5 lines, 4 render 7, a 5th adds no row", () => {
  const stages = ["part1", "part2", "part3", "part4"] as const;
  const make = (n: number) =>
    stages.slice(0, n).map((stage, i) => agent({ id: `a${i}`, stage }));
  assert.equal(renderFooter(state({ agents: make(2) })).length, 5);
  assert.equal(renderFooter(state({ agents: make(4) })).length, 7);
  assert.equal(
    renderFooter(
      state({ agents: [...make(4), agent({ id: "a5", stage: "part2" })] }),
    ).length,
    7,
  );
});

test("non-stage helper agents produce no footer row", () => {
  const lines = renderFooter(
    state({ agents: [agent({ id: "h1" }), agent({ id: "h2" })] }),
  );
  assert.equal(lines.length, 3);
});

test("every line fits the requested width at 20, 60, 80, and 200", () => {
  const agents = (["part1", "part2", "part3", "part4"] as const).map(
    (stage, i) =>
      agent({
        id: `a${i}`,
        stage,
        modelLabel: "a-quite-long-model-name/gpt-5.6-luna-preview",
        turns: 123,
      }),
  );
  for (const width of [20, 60, 80, 200]) {
    const lines = renderFooter(
      state({
        width,
        agents,
        statuses: ["some extension status line that is far too long to fit"],
        readingFor: () =>
          buildReading({ source: "context", done: 50, total: 100, at: 10_000 }),
      }),
    );
    assert.equal(lines.length, 8);
    for (const line of lines) {
      assert.ok(
        visibleWidth(line) <= width,
        `width ${width}: ${JSON.stringify(line)} is ${visibleWidth(line)}`,
      );
    }
  }
});

test("an indeterminate reading renders no % character", () => {
  const lines = renderFooter(
    state({
      agents: [agent({ stage: "part2" })],
      readingFor: () => buildReading({ source: "stage", at: 10_000 }),
    }),
  );
  assert.equal(lines.length, 4);
  assert.ok(!lines[3].includes("%"));
  assert.ok(lines[3].includes("part2"));
  assert.ok(lines[3].includes("pi/?"));
  assert.ok(lines[3].includes("3t"));
});

test("a measured reading renders a rounded percent", () => {
  const lines = renderFooter(
    state({
      agents: [agent({ stage: "part1" })],
      readingFor: () =>
        buildReading({ source: "context", done: 1, total: 3, at: 10_000 }),
    }),
  );
  assert.ok(lines[3].includes("33%"));
});

test("a stale reading renders with a leading ~", () => {
  const lines = renderFooter(
    state({
      now: 100_000,
      agents: [agent({ stage: "part3" })],
      readingFor: () =>
        buildReading({ source: "context", done: 1, total: 2, at: 60_000 }),
    }),
  );
  assert.ok(lines[3].startsWith("~"), JSON.stringify(lines[3]));
  assert.ok(lines[3].includes("50%"));
});

test("a fresh reading has no ~ prefix", () => {
  const lines = renderFooter(
    state({
      agents: [agent({ stage: "part3" })],
      readingFor: () =>
        buildReading({ source: "context", done: 1, total: 2, at: 10_000 }),
    }),
  );
  assert.ok(!lines[3].includes("~"));
});

test("a throwing reading getter still returns the 3 base lines", () => {
  const lines = renderFooter(
    state({
      agents: [agent({ stage: "part2" })],
      statuses: ["ignored on failure"],
      readingFor: () => {
        throw new Error("boom");
      },
    }),
  );
  assert.equal(lines.length, 3);
  assert.ok(lines[0].includes("~/repo"));
});

test("stage rows sort part1 → part4 regardless of input order", () => {
  const lines = renderFooter(
    state({
      agents: [
        agent({ id: "a4", stage: "part4" }),
        agent({ id: "a1", stage: "part1" }),
      ],
    }),
  );
  assert.ok(lines[3].includes("part1"));
  assert.ok(lines[4].includes("part4"));
});

test("elapsed renders from startedAt and clamps at 0", () => {
  const lines = renderFooter(
    state({
      now: 61_000,
      agents: [agent({ stage: "part2", startedAt: 1_000 })],
    }),
  );
  assert.ok(lines[3].includes("1m"));
  const future = renderFooter(
    state({ now: 500, agents: [agent({ stage: "part2", startedAt: 1_000 })] }),
  );
  assert.ok(future[3].includes("0s"));
});

test("extension status lines append after stage rows, split and truncated", () => {
  const lines = renderFooter(
    state({
      width: 30,
      agents: [agent({ stage: "part1" })],
      statuses: ["one\ntwo three four five six seven"],
    }),
  );
  assert.equal(lines.length, 6);
  assert.equal(lines[4], "one");
  assert.ok(visibleWidth(lines[5]) <= 30);
});

test("1 000 renders at width 200 complete in under 2 000 ms", () => {
  const agents = (["part1", "part2", "part3", "part4"] as const).map(
    (stage, i) => agent({ id: `a${i}`, stage, turns: 40 }),
  );
  const input = state({
    width: 200,
    agents,
    statuses: ["status one", "status two"],
    readingFor: () =>
      buildReading({ source: "context", done: 100, total: 200, at: 10_000 }),
  });
  const start = performance.now();
  for (let i = 0; i < 1_000; i++) renderFooter(input);
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 2_000, `1000 renders took ${elapsed}ms`);
});

test("the module imports no fs, subprocess, or network APIs", () => {
  const source = readFileSync(new URL("./footer.ts", import.meta.url), "utf8");
  assert.doesNotMatch(
    source,
    /from\s+["']node:(fs|child_process|http|https|net|os|path)/,
  );
  assert.doesNotMatch(source, /\b(fetch|XMLHttpRequest|WebSocket)\s*\(/);
});
