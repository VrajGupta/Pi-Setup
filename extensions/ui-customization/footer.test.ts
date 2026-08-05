import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  buildReading,
  type ProgressReading,
} from "../shared/stage-progress.ts";
import {
  SUBAGENT_STATE_CHANNEL,
  WORKFLOW_STATE_CHANNEL,
  type WorkflowSubagentSummary,
} from "../shared/workflow-state.ts";
import { renderFooter, type FooterState } from "./footer.ts";
import uiCustomization from "./index.ts";

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
    runtime: "pi/model · high · · coder",
    rail: "flow · planner → ◉ coder → · debugger → · reviewer",
    routeStatus: "fleet/coder · running",
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
  const stages = ["planner", "coder", "debugger", "reviewer"] as const;
  const make = (n: number) =>
    stages.slice(0, n).map((stage, i) => agent({ id: `a${i}`, stage }));
  assert.equal(renderFooter(state({ agents: make(2) })).length, 5);
  assert.equal(renderFooter(state({ agents: make(4) })).length, 7);
  assert.equal(
    renderFooter(
      state({ agents: [...make(4), agent({ id: "a5", stage: "coder" })] }),
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
  const agents = (["planner", "coder", "debugger", "reviewer"] as const).map(
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
    assert.equal(lines.length, 7);
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
      agents: [agent({ stage: "coder" })],
      readingFor: () => buildReading({ source: "stage", at: 10_000 }),
    }),
  );
  assert.equal(lines.length, 4);
  assert.ok(!lines[3].includes("%"));
  assert.ok(lines[3].includes("coder"));
  assert.ok(lines[3].includes("pi/?"));
  assert.ok(lines[3].includes("3t"));
});

test("a measured reading labels context use without a misleading rounded zero", () => {
  const rounded = renderFooter(
    state({
      agents: [agent({ stage: "planner" })],
      readingFor: () =>
        buildReading({ source: "context", done: 1, total: 3, at: 10_000 }),
    }),
  );
  assert.ok(rounded[3].includes("33% ctx"));

  const tiny = renderFooter(
    state({
      agents: [agent({ stage: "planner" })],
      readingFor: () =>
        buildReading({ source: "context", done: 1, total: 1_000, at: 10_000 }),
    }),
  );
  assert.ok(tiny[3].includes("<1% ctx"));
  assert.ok(!tiny[3].includes("0%"));
});

test("a stale reading renders with a leading ~", () => {
  const lines = renderFooter(
    state({
      now: 100_000,
      agents: [agent({ stage: "debugger" })],
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
      agents: [agent({ stage: "debugger" })],
      readingFor: () =>
        buildReading({ source: "context", done: 1, total: 2, at: 10_000 }),
    }),
  );
  assert.ok(!lines[3].includes("~"));
});

test("stage rows keep a closed, redacted reason when stale or indeterminate", () => {
  const stale = renderFooter(
    state({
      width: 200,
      now: 100_000,
      agents: [agent({ stage: "coder", modelLabel: "model%label" })],
      readingFor: () => buildReading({ source: "stage", at: 60_000 }),
      reasonFor: () =>
        "provider error: \u001b[2JAuthorization: Bearer synthetic-secret-token",
    }),
  )[3];
  assert.match(stale, /^~ provider error/);
  assert.match(stale, /\[REDACTED\]/);
  assert.doesNotMatch(stale, /synthetic-secret-token|%|\u001b/);

  const unknown = renderFooter(
    state({
      width: 200,
      agents: [agent({ stage: "coder" })],
      reasonFor: () => "unrecognised internal state",
    }),
  )[3];
  assert.match(unknown, /reason unknown/);
});

test("reason redaction covers bare key= and cookie assignments (INV-2)", () => {
  for (const text of [
    "provider error: key=super-secret-value",
    "provider error: Cookie=session=abc; Path=/",
    "provider error: password=hunter2",
  ]) {
    const lines = renderFooter(
      state({
        width: 200,
        agents: [agent({ stage: "coder" })],
        reasonFor: () => text,
      }),
    ).join("\n");
    assert.doesNotMatch(lines, /super-secret-value|abc|hunter2/);
    assert.match(lines, /\[REDACTED\]/);
  }
});

test("a throwing reading or reason getter still returns the 3 base lines", () => {
  for (const overrides of [
    {
      readingFor: () => {
        throw new Error("boom");
      },
    },
    {
      reasonFor: () => {
        throw new Error("boom");
      },
    },
  ]) {
    const lines = renderFooter(
      state({
        agents: [agent({ stage: "coder" })],
        statuses: ["ignored on failure"],
        ...overrides,
      }),
    );
    assert.equal(lines.length, 3);
    assert.ok(lines[0].includes("~/repo"));
  }
});

test("stage rows sort planner → reviewer regardless of input order", () => {
  const lines = renderFooter(
    state({
      agents: [
        agent({ id: "a4", stage: "reviewer" }),
        agent({ id: "a1", stage: "planner" }),
      ],
    }),
  );
  assert.ok(lines[3].includes("planner"));
  assert.ok(lines[4].includes("reviewer"));
});

test("elapsed renders from startedAt and clamps at 0", () => {
  const lines = renderFooter(
    state({
      now: 61_000,
      agents: [agent({ stage: "coder", startedAt: 1_000 })],
    }),
  );
  assert.ok(lines[3].includes("1m"));
  const future = renderFooter(
    state({ now: 500, agents: [agent({ stage: "coder", startedAt: 1_000 })] }),
  );
  assert.ok(future[3].includes("0s"));
});

test("extension status lines append after stage rows, split and truncated", () => {
  const lines = renderFooter(
    state({
      width: 30,
      agents: [agent({ stage: "planner" })],
      statuses: ["one\ntwo three four five six seven"],
    }),
  );
  assert.equal(lines.length, 6);
  assert.equal(lines[4], "one");
  assert.ok(visibleWidth(lines[5]) <= 30);
});

test("1 000 renders at width 200 complete in under 2 000 ms", () => {
  const agents = (["planner", "coder", "debugger", "reviewer"] as const).map(
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

test("the shipped index.ts footer wrapper performs no render-path I/O", () => {
  const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  // The wrapper may import node:os/node:path for identity, but render-path
  // purity (INV-3) is unprovable if any I/O-capable module can be imported at
  // all: an imported binding could be called inside render while a region
  // scan only searches for the module-specifier text. Forbid the modules
  // module-wide so the invariant is mutation-proof.
  assert.doesNotMatch(
    source,
    /from\s+["']node:(fs|child_process|http|https|net)/,
  );
  assert.doesNotMatch(source, /\b(fetch|XMLHttpRequest|WebSocket)\s*\(/);
  // And no I/O binding call may appear in the footer render region.
  const renderRegion = source.slice(source.indexOf("setFooter"), source.length);
  assert.doesNotMatch(
    renderRegion,
    /\b(readFileSync|writeFileSync|readdirSync|execSync|spawn|exec|fetch|XMLHttpRequest|WebSocket)\s*\(/,
  );
});

test("unknown stages are omitted, duplicate stages remain distinct, and input order is preserved", () => {
  const agents = [
    agent({ id: "reviewer", stage: "reviewer", modelLabel: "model-reviewer" }),
    agent({
      id: "unknown",
      stage: "mystery" as WorkflowSubagentSummary["stage"],
    }),
    agent({ id: "coder-a", stage: "coder", modelLabel: "model-coder-a" }),
    agent({ id: "coder-b", stage: "coder", modelLabel: "model-coder-b" }),
  ];
  const before = [...agents];
  const lines = renderFooter(state({ agents }));

  assert.equal(lines.length, 6);
  assert.ok(lines[3].includes("model-coder-a"));
  assert.ok(lines[4].includes("model-coder-b"));
  assert.ok(lines[5].includes("model-reviewer"));
  assert.deepEqual(agents, before);
});

test("very narrow and non-finite widths never throw or overflow", () => {
  const input = state({
    width: 0,
    agents: [agent({ stage: "planner", modelLabel: "模型😀" })],
  });
  for (const width of [0, 1, 2, 3, 4, 19, Number.NaN, Infinity]) {
    assert.doesNotThrow(() => renderFooter({ ...input, width }));
    const lines = renderFooter({ ...input, width });
    for (const line of lines) {
      assert.ok(
        visibleWidth(line) <=
          Math.max(0, Math.floor(Number.isFinite(width) ? width : 0)),
        `${width}: ${JSON.stringify(line)}`,
      );
    }
  }
});

test("empty and unicode model labels use a safe fallback and ANSI width is measured visibly", () => {
  const ansiTheme = {
    fg: (_color: string, text: string) => `\u001b[38;5;33m${text}\u001b[0m`,
  };
  const lines = renderFooter(
    state({
      width: 80,
      theme: ansiTheme,
      agents: [
        agent({ stage: "planner", modelLabel: "" }),
        agent({ stage: "coder", modelLabel: "模型😀模型😀模型😀" }),
      ],
    }),
  );

  assert.ok(lines[3].includes("pi/?"));
  for (const line of lines) assert.ok(visibleWidth(line) <= 80);
});

test("non-finite timestamps, counters, clocks, and readings degrade without fabricated output", () => {
  const lines = renderFooter(
    state({
      now: Infinity,
      agents: [
        agent({ stage: "debugger", startedAt: Number.NaN, turns: Infinity }),
      ],
      readingFor: () =>
        ({
          kind: "measured",
          percent: Number.NaN,
          done: 1,
          total: 2,
          source: "context",
          at: Number.POSITIVE_INFINITY,
        }) as ProgressReading,
    }),
  );

  assert.equal(lines.length, 4);
  assert.ok(lines[3].startsWith("~"));
  assert.ok(!lines[3].includes("NaN"));
  assert.ok(!lines[3].includes("Infinity"));
  assert.ok(!lines[3].includes("%"));
});

test("malformed measured readings and secret-shaped provider reasons fail closed", () => {
  const line = renderFooter(
    state({
      width: 200,
      agents: [agent({ stage: "coder" })],
      readingFor: () => ({
        kind: "measured",
        percent: 0,
        done: 1,
        total: 2,
        source: "context",
        at: 10_000,
      }),
      reasonFor: () =>
        "provider error: upstream reported 50% failure; api_key=PI12_API_SECRET password=PI12_PASSWORD_SECRET Cookie: session=PI12_COOKIE_SECRET",
    }),
  )[3];

  assert.match(line, /^~ provider error/);
  assert.doesNotMatch(
    line,
    /0%|PI12_API_SECRET|PI12_PASSWORD_SECRET|PI12_COOKIE_SECRET/,
  );
  assert.match(line, /\[REDACTED\]/);

  const inconsistent = renderFooter(
    state({
      agents: [agent({ stage: "coder", modelLabel: "model%label" })],
      readingFor: () => ({
        kind: "measured",
        percent: 99,
        done: 1,
        total: 2,
        source: "context",
        at: 10_000,
      }),
    }),
  )[3];
  assert.match(inconsistent, /^~/);
  assert.doesNotMatch(inconsistent, /%/);
});

test("the stale boundary is fresh at exactly 30 seconds and stale one millisecond later", () => {
  const reading = () =>
    buildReading({ source: "context", done: 1, total: 2, at: 70_000 });
  const fresh = renderFooter(
    state({
      now: 100_000,
      agents: [agent({ stage: "planner" })],
      readingFor: reading,
    }),
  );
  const stale = renderFooter(
    state({
      now: 100_001,
      agents: [agent({ stage: "planner" })],
      readingFor: reading,
    }),
  );

  assert.ok(!fresh[3].startsWith("~"));
  assert.ok(stale[3].startsWith("~"));
});

test("theme and status rendering failures fall back to bounded base lines", () => {
  const lines = renderFooter(
    state({
      agents: [agent({ stage: "planner" })],
      statuses: ["a status that should not escape the width"],
      theme: {
        fg() {
          throw new Error("theme unavailable");
        },
      },
    }),
  );

  assert.equal(lines.length, 5);
  for (const line of lines) assert.ok(visibleWidth(line) <= 80);
});

test("live subagent state reaches the footer as measured context progress and omits helpers", () => {
  type EventHandler = (value: unknown) => void;
  const listeners = new Map<string, Set<EventHandler>>();
  const hooks = new Map<string, (...args: unknown[]) => void>();
  let headerFactory:
    | ((
        tui: { requestRender(): void },
        theme: typeof plainTheme,
      ) => { render(width: number): string[] })
    | undefined;
  let footerFactory:
    | ((
        tui: { requestRender(): void },
        theme: typeof plainTheme,
        footerData: { getExtensionStatuses(): Map<string, string> },
      ) => { render(width: number): string[] })
    | undefined;
  const theme = plainTheme;
  const pi = {
    events: {
      on(channel: string, handler: EventHandler) {
        const channelListeners =
          listeners.get(channel) ?? new Set<EventHandler>();
        channelListeners.add(handler);
        listeners.set(channel, channelListeners);
        return () => channelListeners.delete(handler);
      },
      emit(channel: string, value: unknown) {
        for (const handler of listeners.get(channel) ?? []) handler(value);
      },
    },
    on(event: string, handler: (...args: unknown[]) => void) {
      hooks.set(event, handler);
    },
    getThinkingLevel() {
      return "high";
    },
  };
  const context = {
    mode: "tui",
    cwd: "/repo",
    ui: {
      theme,
      setHeader(factory: typeof headerFactory) {
        headerFactory = factory;
      },
      setFooter(factory: typeof footerFactory) {
        footerFactory = factory;
      },
      setTitle() {},
    },
  };

  uiCustomization(pi as never);
  hooks.get("session_start")?.({}, context);
  assert.ok(headerFactory);
  assert.ok(footerFactory);
  const header = headerFactory({ requestRender() {} }, theme);
  const footer = footerFactory({ requestRender() {} }, theme, {
    getExtensionStatuses: () => new Map(),
  });
  pi.events.emit(WORKFLOW_STATE_CHANNEL, {
    status: "running",
    activeStage: "coder",
    route: { mode: "fleet", stage: "coder" },
    updatedAt: Date.now(),
  });
  pi.events.emit(SUBAGENT_STATE_CHANNEL, [
    agent({
      id: "stage-agent",
      stage: "coder",
      contextTokens: 25,
      contextWindow: 100,
    }),
    agent({ id: "helper-agent" }),
  ]);

  const lines = footer.render(80);
  assert.equal(lines.length, 4);
  assert.ok(lines[3].includes("coder"));
  assert.ok(lines[3].includes("25%"));
  assert.ok(!lines.some((line) => line.includes("helper-agent")));
  assert.doesNotMatch([...header.render(80), ...lines].join("\n"), /steer/i);

  const statusFailureFooter = footerFactory({ requestRender() {} }, theme, {
    getExtensionStatuses() {
      throw new Error("status provider unavailable");
    },
  });
  assert.doesNotThrow(() => statusFailureFooter.render(80));
  // INV-6: a throwing extension-status getter degrades to the 3 base lines.
  assert.equal(statusFailureFooter.render(80).length, 3);

  // INV-3: the shipped wrapper (index.ts) renders within budget too — the
  // pure-footer benchmark above must not be the only perf proof.
  const liveFooter = footerFactory({ requestRender() {} }, theme, {
    getExtensionStatuses: () => new Map([["ext", "status"]]),
  });
  const start = performance.now();
  for (let i = 0; i < 1_000; i++) liveFooter.render(200);
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 2_000, `wrapper: 1000 renders took ${elapsed}ms`);
});
