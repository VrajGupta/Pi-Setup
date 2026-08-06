import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import uiCustomization from "./index.ts";
import { readStatusWidgetMaxLines } from "./status-widget-settings.ts";
import {
  layoutColumns,
  normalizeMaxLines,
  renderStatusWidget,
  type StatusWidgetAgent,
  type StatusWidgetIssueRecord,
  type StatusWidgetRoutineRecord,
  type StatusWidgetSnapshotView,
  type StatusWidgetState,
} from "./status-widget.ts";

function state(overrides: Partial<StatusWidgetState> = {}): StatusWidgetState {
  return {
    width: 80,
    maxLines: 40,
    inputLines: [],
    ...overrides,
  };
}

function issue(
  overrides: Partial<StatusWidgetIssueRecord> = {},
): StatusWidgetIssueRecord {
  return {
    id: "PI-23",
    title: "issue rows in the widget",
    status: "planned",
    assignee: "planner",
    blockedBy: [],
    blocking: "unblocked",
    ...overrides,
  };
}

function snapshot(
  records: readonly StatusWidgetIssueRecord[],
  overrides: Partial<StatusWidgetSnapshotView> = {},
): StatusWidgetSnapshotView {
  return {
    capturedAt: 100_000,
    records,
    ...overrides,
  };
}

function agent(overrides: Partial<StatusWidgetAgent> = {}): StatusWidgetAgent {
  return {
    stage: "coder",
    status: "running",
    backend: "opencodego",
    model: "deepseek-v4-flash",
    startedAt: 100_000,
    at: 100_000,
    turns: 6,
    context: { kind: "measured", percent: 7 },
    ...overrides,
  };
}

// ── PI-37: maxLines resolved from settings, 0 = unlimited ──

test("PI-37: normalizeMaxLines(0) yields the unlimited sentinel", () => {
  assert.equal(normalizeMaxLines(0), Number.POSITIVE_INFINITY);
});

test("PI-37: normalizeMaxLines maps boundary values", () => {
  assert.equal(normalizeMaxLines(4), 8);
  assert.equal(normalizeMaxLines(500), 200);
  assert.equal(normalizeMaxLines(undefined), 40);
  assert.equal(normalizeMaxLines(null), 40);
  assert.equal(normalizeMaxLines("40"), 40);
  assert.equal(normalizeMaxLines(Number.NaN), 40);
  assert.equal(normalizeMaxLines(-1), 8);
});

test("PI-37: maxLines 0 emits every deterministic line with no overflow", () => {
  // 3 base + 117 input = 120 deterministic lines
  const lines = Array.from({ length: 117 }, (_, i) => `line ${i + 1}`);
  const result = renderStatusWidget(state({ inputLines: lines, maxLines: 0 }));
  assert.equal(result.length, 120);
  assert.equal(result[119], "line 117");
  assert.ok(!result.join("\n").includes("more · /flow"));
});

test("PI-37: maxLines 12 with a deterministic count of 30 emits 12 lines, last is +19 more · /flow", () => {
  // 3 base + 27 input = 30 deterministic lines
  const lines = Array.from({ length: 27 }, (_, i) => `line ${i + 1}`);
  const result = renderStatusWidget(state({ inputLines: lines, maxLines: 12 }));
  assert.equal(result.length, 12);
  assert.equal(result[11], "+19 more · /flow");
});

test("PI-37: settings file with maxLines 0 resolves unlimited; absent key resolves 40", () => {
  const temporary = mkdtempSync(join(tmpdir(), "pi37-settings-"));
  try {
    const unlimited = join(temporary, "unlimited.json");
    writeFileSync(
      unlimited,
      JSON.stringify({ workflow: { statusWidget: { maxLines: 0 } } }),
    );
    assert.equal(readStatusWidgetMaxLines(unlimited), Number.POSITIVE_INFINITY);

    const absent = join(temporary, "absent.json");
    writeFileSync(absent, JSON.stringify({ workflow: { mode: "free" } }));
    assert.equal(readStatusWidgetMaxLines(absent), 40);

    const numeric = join(temporary, "numeric.json");
    writeFileSync(
      numeric,
      JSON.stringify({ workflow: { statusWidget: { maxLines: 500 } } }),
    );
    assert.equal(readStatusWidgetMaxLines(numeric), 200);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("PI-37: unreadable or malformed settings yield 40 and never throw", () => {
  const temporary = mkdtempSync(join(tmpdir(), "pi37-bad-"));
  try {
    assert.equal(readStatusWidgetMaxLines(join(temporary, "missing.json")), 40);
    const malformed = join(temporary, "malformed.json");
    writeFileSync(malformed, "{ not json");
    assert.equal(readStatusWidgetMaxLines(malformed), 40);
    for (const raw of [
      "null",
      "[]",
      "42",
      '"x"',
      JSON.stringify({ workflow: "nope" }),
      JSON.stringify({ workflow: { statusWidget: null } }),
    ]) {
      const file = join(temporary, "case.json");
      writeFileSync(file, raw);
      assert.equal(readStatusWidgetMaxLines(file), 40);
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("PI-37: renderStatusWidget performs no settings read (INV-3)", () => {
  const source = readFileSync(
    new URL("./status-widget.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /getAgentDir|getSettingsPath|settings\.json/);
});

test("PI-37: widget factory passes the resolved maxLines as plain state", () => {
  const listeners = new Map<string, Set<(value: unknown) => void>>();
  const hooks = new Map<string, (...args: unknown[]) => void>();
  const widgets: Array<{ key: string; content: unknown; options?: unknown }> =
    [];
  const theme = { fg: (_color: string, text: string) => text };
  const pi = {
    events: {
      on(channel: string, handler: (value: unknown) => void) {
        const set = listeners.get(channel) ?? new Set();
        set.add(handler);
        listeners.set(channel, set);
        return () => set.delete(handler);
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
      setHeader() {},
      setFooter() {},
      setWidget(key: string, content: unknown, options?: unknown) {
        widgets.push({ key, content, options });
      },
      setTitle() {},
    },
  };

  uiCustomization(pi as never, {
    readStatusWidgetMaxLines: () => Number.POSITIVE_INFINITY,
  });
  hooks.get("session_start")?.({}, context);
  const widget = (
    widgets[0].content as (...args: unknown[]) => {
      render(width: number): string[];
    }
  )({ requestRender() {} }, theme);

  // A 60-ticket snapshot: 3 base + 1 rule + 60 rows = 64 lines. With the
  // unlimited sentinel the surface emits all of them, no +N more line.
  pi.events.emit("vraj:ticket-snapshot", {
    repo: "pi",
    capturedAt: 100_000,
    records: Array.from({ length: 60 }, (_, i) =>
      issue({ id: `PI-${100 + i}`, status: "coding", assignee: "coder" }),
    ),
  });
  const rendered = widget.render(80);
  assert.equal(rendered.length, 64);
  assert.ok(!rendered.join("\n").includes("more · /flow"));
});

// ── PI-20 base (amended for PI-21 flow base) ────────────

test("with 0 input lines, renders the three flow base lines", () => {
  const result = renderStatusWidget(state({ inputLines: [] }));
  assert.equal(result.length, 3);
  assert.match(result[0], /flow/);
  assert.match(result[1], /mode.*route/);
  assert.match(result[2], /planner.*coder.*debugger.*reviewer/);
  // Base lines render real mode/route labels
  assert.ok(result[1].includes("mode workflow"));
  assert.ok(result[1].includes("route direct"));
});

test("with N input lines where N < maxLines, renders base + N lines", () => {
  const lines = ["line 1", "line 2", "line 3"];
  const result = renderStatusWidget(state({ inputLines: lines }));
  assert.equal(result.length, 6); // 3 base + 3 input
  assert.equal(result[3], "line 1");
  assert.equal(result[4], "line 2");
  assert.equal(result[5], "line 3");
});

test("with N input lines where N === maxLines, renders base + N lines and may overflow", () => {
  const lines = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`);
  const result = renderStatusWidget(state({ inputLines: lines, maxLines: 40 }));
  // 3 base + 40 = 43 > 40 → 40 lines with overflow
  assert.equal(result.length, 40);
  assert.ok(result[39].includes("more"));
});

test("with N input lines where N > maxLines, renders maxLines total including overflow", () => {
  const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`);
  const result = renderStatusWidget(state({ inputLines: lines, maxLines: 40 }));
  assert.equal(result.length, 40);
  assert.ok(result[39].includes("+14 more · /flow"));
});

test("maxLines clamps to minimum 8 when passed negative values", () => {
  const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
  const negResult = renderStatusWidget(
    state({ inputLines: lines, maxLines: -100 }),
  );
  assert.equal(negResult.length, 8);
  assert.ok(negResult[7].includes("+96 more · /flow"));
});

test("maxLines defaults to 40 when passed NaN (non-numeric)", () => {
  const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
  const nanResult = renderStatusWidget(
    state({ inputLines: lines, maxLines: NaN }),
  );
  assert.equal(nanResult.length, 40);
  assert.ok(nanResult[39].includes("+64 more · /flow"));
});

test("maxLines clamps to 200 when passed Infinity", () => {
  const lines = Array.from({ length: 250 }, (_, i) => `line ${i + 1}`);
  const infResult = renderStatusWidget(
    state({ inputLines: lines, maxLines: Infinity }),
  );
  assert.equal(infResult.length, 200);
  assert.ok(infResult[199].includes("+54 more · /flow"));
});

test("maxLines clamps to maximum 200 when passed very large values", () => {
  const inputLines = Array.from({ length: 250 }, (_, i) => `line ${i + 1}`);
  const result = renderStatusWidget(state({ inputLines, maxLines: 1e9 }));
  assert.equal(result.length, 200);
  assert.ok(result[199].includes("+54 more · /flow"));
});

test("maxLines defaults to 40 when missing or non-numeric", () => {
  const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`);
  for (const maxLines of [undefined, "not-a-number", null, {}]) {
    const result = renderStatusWidget(
      state({ inputLines: lines, maxLines: maxLines as never }),
    );
    assert.equal(result.length, 40);
    assert.ok(result[39].includes("+14 more · /flow"));
  }
});

test("every line has visible width ≤ requested width at 40, 80, 120, 200", () => {
  const lines = Array.from(
    { length: 50 },
    (_, i) =>
      `\u001b[38;5;33mline ${i + 1} with some extra long content to test width clipping across different widths\u001b[0m`,
  );
  for (const width of [40, 80, 120, 200]) {
    const result = renderStatusWidget(
      state({ inputLines: lines, width, maxLines: 40 }),
    );
    for (const line of result) {
      assert.ok(
        visibleWidth(line) <= width,
        `width ${width}: line "${line}" has visible width ${visibleWidth(line)}`,
      );
    }
  }
});

test("width normalization: 0 and negative widths return empty array", () => {
  const lines = ["line 1", "line 2"];
  assert.deepEqual(
    renderStatusWidget(state({ inputLines: lines, width: 0 })),
    [],
  );
  assert.deepEqual(
    renderStatusWidget(state({ inputLines: lines, width: -10 })),
    [],
  );
  assert.deepEqual(
    renderStatusWidget(state({ inputLines: lines, width: NaN })),
    [],
  );
});

test("1000 renders at width 200 complete in under 2000ms", () => {
  const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
  const start = Date.now();
  for (let i = 0; i < 1000; i++) {
    renderStatusWidget(state({ inputLines: lines, width: 200, maxLines: 40 }));
  }
  const elapsed = Date.now() - start;
  assert.ok(
    elapsed < 2000,
    `1000 renders took ${elapsed}ms, expected < 2000ms`,
  );
});

test("malformed inputLines degrades gracefully", () => {
  // Non-array inputLines
  const nonArray = renderStatusWidget(
    state({ inputLines: "not an array" as never }),
  );
  assert.deepEqual(nonArray, []);

  // null inputLines
  const nullLines = renderStatusWidget(state({ inputLines: null as never }));
  assert.deepEqual(nullLines, []);

  // undefined is handled by default state
  const undefinedLines = renderStatusWidget(
    state({ inputLines: undefined as never }),
  );
  assert.deepEqual(undefinedLines, []);
});

test("malformed width degrades gracefully", () => {
  const lines = ["line 1"];
  const string = renderStatusWidget(
    state({ inputLines: lines, width: "80" as never }),
  );
  assert.deepEqual(string, []);

  const obj = renderStatusWidget(
    state({ inputLines: lines, width: {} as never }),
  );
  assert.deepEqual(obj, []);

  const inf = renderStatusWidget(state({ inputLines: lines, width: Infinity }));
  assert.deepEqual(inf, []);
});

test("overflow line is absent at the ceiling and counts every suppressed row", () => {
  // 3 base + 7 input = 10, maxLines 10 = exact fit
  const exact = renderStatusWidget(
    state({ inputLines: Array(7).fill("line"), maxLines: 10 }),
  );
  assert.equal(exact.length, 10);
  assert.doesNotMatch(exact[9], /more · \/flow/);

  // 3 base + 8 input = 11 > 10 → overflow
  const oneOver = renderStatusWidget(
    state({ inputLines: Array(8).fill("line"), maxLines: 10 }),
  );
  assert.equal(oneOver.length, 10);
  assert.equal(oneOver[9], "+2 more · /flow");

  // 3 base + 47 input = 50 > 10 → overflow
  const many = renderStatusWidget(
    state({ inputLines: Array(47).fill("line"), maxLines: 10 }),
  );
  assert.equal(many[9], "+41 more · /flow");
});

test("throwing state getters return bounded base lines (INV-6)", () => {
  const throwingInput = {
    width: 80,
    maxLines: 40,
    get inputLines(): readonly string[] {
      throw new Error("boom");
    },
  };
  const inputFallback = renderStatusWidget(throwingInput);
  assert.equal(inputFallback.length, 3);
  assert.match(inputFallback[0], /flow/);
  assert.match(inputFallback[1], /mode.*route/);
  assert.match(inputFallback[2], /planner.*coder.*debugger.*reviewer/);

  const throwingWidth = {
    get width(): number {
      throw new Error("boom");
    },
    maxLines: 40,
    inputLines: ["line 1"],
  };
  const widthFallback = renderStatusWidget(throwingWidth);
  assert.equal(widthFallback.length, 3);
  for (const line of widthFallback) assert.ok(visibleWidth(line) <= 80);
});

test("input lines are converted to strings and truncated", () => {
  const lines = ["plain string", 123 as never];
  const result = renderStatusWidget(
    state({ inputLines: lines as readonly string[] }),
  );
  assert.equal(result.length, 5); // 3 base + 2 input
  assert.equal(result[3], "plain string");
  assert.equal(result[4], "123");
});

test("render module has no filesystem, network, or subprocess path", () => {
  const source = readFileSync(
    new URL("./status-widget.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /from\s+["']node:(fs|child_process|http|https|net|dns|tls|dgram)/,
  );
  assert.doesNotMatch(
    source,
    /\b(fetch|XMLHttpRequest|WebSocket|readFileSync|writeFileSync|spawn|exec)\s*\(/,
  );
});

test("registers belowEditor widget, cleans it up, and keeps header/footer usable", () => {
  const listeners = new Map<string, Set<(value: unknown) => void>>();
  const hooks = new Map<string, (...args: unknown[]) => void>();
  const widgets: Array<{ key: string; content: unknown; options?: unknown }> =
    [];
  let headerFactory: unknown;
  let footerFactory: unknown;
  const theme = { fg: (_color: string, text: string) => text };
  const pi = {
    events: {
      on(channel: string, handler: (value: unknown) => void) {
        const channelListeners = listeners.get(channel) ?? new Set();
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
      setHeader(factory: unknown) {
        headerFactory = factory;
      },
      setFooter(factory: unknown) {
        footerFactory = factory;
      },
      setWidget(key: string, content: unknown, options?: unknown) {
        widgets.push({ key, content, options });
      },
      setTitle() {},
    },
  };

  uiCustomization(pi as never, { readStatusWidgetMaxLines: () => 40 });
  hooks.get("session_start")?.({}, context);
  assert.equal(widgets.length, 1);
  assert.equal(widgets[0].key, "vraj-status");
  assert.deepEqual(widgets[0].options, { placement: "belowEditor" });
  assert.equal(typeof widgets[0].content, "function");
  assert.ok(headerFactory);
  assert.ok(footerFactory);

  const header = (
    headerFactory as (...args: unknown[]) => { render(width: number): string[] }
  )({ requestRender() {} }, theme);
  const footer = (
    footerFactory as (...args: unknown[]) => { render(width: number): string[] }
  )({ requestRender() {} }, theme, { getExtensionStatuses: () => new Map() });
  assert.equal(header.render(80).length, 1);
  assert.equal(footer.render(80).length, 3);

  hooks.get("session_shutdown")?.({}, context);
  assert.equal(widgets.at(-1)?.key, "vraj-status");
  assert.equal(widgets.at(-1)?.content, undefined);
});

// ── PI-36: published ticket snapshots reach the widget ──

test("PI-36: emitted snapshots render issue rows; malformed values keep the prior view", () => {
  const listeners = new Map<string, Set<(value: unknown) => void>>();
  const hooks = new Map<string, (...args: unknown[]) => void>();
  const widgets: Array<{ key: string; content: unknown; options?: unknown }> =
    [];
  const theme = { fg: (_color: string, text: string) => text };
  const pi = {
    events: {
      on(channel: string, handler: (value: unknown) => void) {
        const set = listeners.get(channel) ?? new Set();
        set.add(handler);
        listeners.set(channel, set);
        return () => set.delete(handler);
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
      setHeader() {},
      setFooter() {},
      setWidget(key: string, content: unknown, options?: unknown) {
        widgets.push({ key, content, options });
      },
      setTitle() {},
    },
  };

  uiCustomization(pi as never, { readStatusWidgetMaxLines: () => 40 });
  hooks.get("session_start")?.({}, context);
  const widget = (
    widgets[0].content as (...args: unknown[]) => {
      render(width: number): string[];
    }
  )({ requestRender() {} }, theme);

  // No snapshot published yet → no issues section (the live gap PI-36 closes).
  assert.equal(
    widget.render(80).find((line) => line.includes("issues")),
    undefined,
  );

  // One completed poll read publishes a snapshot → rows render (INV-10).
  pi.events.emit("vraj:ticket-snapshot", {
    repo: "pi",
    capturedAt: 100_000,
    records: [
      issue({
        id: "PI-36",
        status: "coding",
        assignee: "coder",
        title: "wire the poll",
      }),
      issue({ id: "PI-35", status: "done", assignee: "reviewer" }),
    ],
  });
  const rendered = widget.render(80);
  assert.ok(rendered.find((l) => l.includes("issues · 1 active · 1 done")));
  assert.ok(rendered.find((l) => l.includes("PI-36")));
  assert.ok(rendered.find((l) => l.includes("wire the poll")));
  assert.equal(
    rendered.find((l) => l.includes("PI-35")),
    undefined,
    "done tickets are counted, not listed",
  );

  // A reasoned snapshot renders exactly the unavailable line (INV-10).
  pi.events.emit("vraj:ticket-snapshot", {
    repo: "pi",
    capturedAt: 100_000,
    records: [],
    reason: "timeout",
  });
  const unavailable = widget.render(80);
  assert.ok(
    unavailable.find((l) => l.includes("issues unavailable — timeout")),
  );
  assert.equal(
    unavailable.find((l) => l.includes("PI-36")),
    undefined,
  );

  // Malformed/throwing published values leave the prior view in place (INV-6).
  for (const bad of [
    null,
    "nope",
    {},
    { capturedAt: "100" },
    { capturedAt: 100_000, records: "bad" },
    { capturedAt: 100_000, reason: 42 },
  ]) {
    pi.events.emit("vraj:ticket-snapshot", bad);
  }
  const afterMalformed = widget.render(80);
  assert.ok(
    afterMalformed.find((l) => l.includes("issues unavailable — timeout")),
    "previous snapshot survives malformed publishes",
  );

  // session_shutdown clears the listener; later publishes are no-ops.
  hooks.get("session_shutdown")?.({}, context);
  pi.events.emit("vraj:ticket-snapshot", {
    repo: "pi",
    capturedAt: 100_000,
    records: [issue({ id: "PI-99" })],
  });
  assert.equal(widgets.length, 2, "widget cleared, nothing re-registered");
  assert.equal(widgets.at(-1)?.content, undefined);
  assert.doesNotThrow(() => widget.render(80));
});

// ── PI-21: mode / route rows ────────────────────────────

test("mode row: renders exactly 'mode workflow' or 'mode free (manual)'", () => {
  const result = renderStatusWidget(state({}));
  assert.ok(result[1].includes("mode workflow"));

  const free = renderStatusWidget(state({ mode: "free" }));
  assert.ok(free[1].includes("mode free (manual)"));

  // Absent/invalid → mode workflow
  const absent = renderStatusWidget(state({ mode: undefined }));
  assert.ok(absent[1].includes("mode workflow"));

  // Unknown value → mode workflow
  const unknown = renderStatusWidget(state({ mode: "bogus" }));
  assert.ok(unknown[1].includes("mode workflow"));
});

test("route row: renders exactly 'route direct' or 'route fleet/<stage>'", () => {
  // No route → route direct
  const direct = renderStatusWidget(state({ route: null }));
  assert.ok(direct[1].includes("route direct"));

  // Fleet with coder stage
  const fleetCoder = renderStatusWidget(
    state({ route: { mode: "fleet", stage: "coder" } }),
  );
  assert.ok(fleetCoder[1].includes("route fleet/coder"));

  // Fleet with null stage → route fleet
  const fleetNull = renderStatusWidget(
    state({ route: { mode: "fleet", stage: null } }),
  );
  assert.ok(fleetNull[1].includes("route fleet"));

  // No route mode field → route direct
  const noMode = renderStatusWidget(state({ route: {} }));
  assert.ok(noMode[1].includes("route direct"));

  // Fleet with Symbol stage → route fleet (no crash)
  const symbol = renderStatusWidget(
    state({ route: { mode: "fleet", stage: Symbol("bad") as never } }),
  );
  assert.ok(symbol[1].includes("route fleet"));
});

// ── PI-21: stage rail ───────────────────────────────────

test("stage rail: active stage gets ◉, complete stages get ✓, pending get ·", () => {
  // Active coder, status running
  // Active coder → planner completed (✓), coder active (◉), rest pending (·)
  const running = renderStatusWidget(
    state({ activeStage: "coder", workflowStatus: "running" }),
  );
  assert.ok(running[2].includes("✓ planner"));
  assert.ok(running[2].includes("◉ coder"));
  assert.ok(running[2].includes("· debugger"));
  assert.ok(running[2].includes("· reviewer"));

  // Status complete → all ✓
  const complete = renderStatusWidget(
    state({ activeStage: "coder", workflowStatus: "complete" }),
  );
  assert.ok(complete[2].includes("✓ planner"));
  assert.ok(complete[2].includes("✓ coder"));
  assert.ok(complete[2].includes("✓ debugger"));
  assert.ok(complete[2].includes("✓ reviewer"));

  // Active debugger → planner, coder ✓, debugger ◉, reviewer ·
  const debuggerActive = renderStatusWidget(state({ activeStage: "debugger" }));
  assert.ok(debuggerActive[2].includes("✓ planner"));
  assert.ok(debuggerActive[2].includes("✓ coder"));
  assert.ok(debuggerActive[2].includes("◉ debugger"));
  assert.ok(debuggerActive[2].includes("· reviewer"));
});

test("stage rail: collapses to active stage when width < 60", () => {
  const wide = renderStatusWidget(
    state({ width: 80, activeStage: "coder", workflowStatus: "running" }),
  );
  // Full rail at width 80
  assert.ok(wide[2].includes("✓ planner"));
  assert.ok(wide[2].includes("◉ coder"));

  const narrow = renderStatusWidget(
    state({ width: 50, activeStage: "coder", workflowStatus: "running" }),
  );
  // Collapsed: only active stage
  assert.ok(narrow[2].includes("◉ coder"));
  assert.ok(!narrow[2].includes("planner"));
  assert.ok(!narrow[2].includes("debugger"));
  assert.ok(!narrow[2].includes("reviewer"));
});

test("stage rail: with no active stage renders full rail with · glyphs", () => {
  const result = renderStatusWidget(
    state({ activeStage: null, workflowStatus: "idle" }),
  );
  assert.ok(result[2].includes("· planner"));
  assert.ok(result[2].includes("· coder"));
  assert.ok(result[2].includes("· debugger"));
  assert.ok(result[2].includes("· reviewer"));
});

// ── PI-21: agent rows ───────────────────────────────────

test("agent rows: known stage agents render with glyph, stage, backend/model, elapsed, turns, ctx", () => {
  const result = renderStatusWidget(
    state({
      width: 100, // ≥100 so backend/model column is present
      agents: [
        agent({
          stage: "coder",
          startedAt: 100_000,
          at: 100_000,
          turns: 6,
          context: { kind: "measured", percent: 7 },
        }),
      ],
      now: 100_000,
    }),
  );
  assert.equal(result.length, 4); // 3 base + 1 agent
  const row = result[3];
  assert.ok(row.includes("◉")); // running glyph
  assert.ok(row.includes("coder")); // stage
  assert.ok(row.includes("opencodego/deepseek-v4-flash")); // backend/model
  assert.ok(row.includes("0s")); // elapsed: now === startedAt → 0s
  assert.ok(row.includes("6t")); // turns
  assert.ok(row.includes("7% ctx")); // context
});

test("agent rows: helper agents (no known stage) are excluded", () => {
  const result = renderStatusWidget(
    state({
      agents: [agent({ stage: "coder" }), agent({ stage: "unknown-helper" })],
      now: 100_000,
    }),
  );
  assert.equal(result.length, 4); // 3 base + 1 coder agent
  assert.ok(result[3].includes("coder"));
  // Helper is excluded
  assert.ok(!result.find((l) => l.includes("unknown-helper")));
});

test("agent rows: sorted by stage order", () => {
  const result = renderStatusWidget(
    state({
      width: 100, // ≥100 so backend/model column is present (identifies rows)
      agents: [
        agent({ stage: "reviewer", model: "grok" }),
        agent({ stage: "coder", model: "deepseek" }),
        agent({ stage: "planner", model: "claude" }),
      ],
      now: 100_000,
    }),
  );
  assert.equal(result.length, 6); // 3 base + 3 agents
  // planner, coder, reviewer order
  const plannerIdx = result.findIndex((l) => l.includes("claude"));
  const coderIdx = result.findIndex((l) => l.includes("deepseek"));
  const reviewerIdx = result.findIndex((l) => l.includes("grok"));
  assert.ok(
    plannerIdx >= 0 && coderIdx >= 0 && reviewerIdx >= 0,
    "all models present",
  );
  assert.ok(plannerIdx < coderIdx, "planner before coder");
  assert.ok(coderIdx < reviewerIdx, "coder before reviewer");
});

test("agent rows: backend/model column dropped at width < 100", () => {
  const wide = renderStatusWidget(
    state({
      width: 100,
      agents: [agent()],
      now: 100_000,
    }),
  );
  assert.ok(wide[3].includes("opencodego/"));

  const narrow = renderStatusWidget(
    state({
      width: 80,
      agents: [agent()],
      now: 100_000,
    }),
  );
  assert.ok(!narrow[3].includes("opencodego/"));
});

test("agent rows: undefined context renders '? ctx' and no '0%'", () => {
  const result = renderStatusWidget(
    state({
      agents: [agent({ context: { kind: "unknown" } })],
      now: 100_000,
    }),
  );
  assert.ok(result[3].includes("? ctx"));
  assert.ok(!result[3].includes("0%"));
});

test("agent rows: positive sub-1% context renders '<1% ctx'", () => {
  const result = renderStatusWidget(
    state({
      agents: [agent({ context: { kind: "measured", percent: 0.35 } })],
      now: 100_000,
    }),
  );
  assert.ok(result[3].includes("<1% ctx"));
});

test("agent rows: stale reading renders '~' prefix with age", () => {
  // Stale: now - at > 30_000ms
  // startedAt = 50_000, at = 50_000, now = 90_000 → elapsed 40s, stale true
  const stale = renderStatusWidget(
    state({
      agents: [agent({ startedAt: 50_000, at: 50_000 })],
      now: 90_000,
    }),
  );
  assert.ok(stale[3].includes("~40s"));

  // Fresh: now - at <= 30_000ms
  const fresh = renderStatusWidget(
    state({
      agents: [agent({ startedAt: 70_000, at: 70_000 })],
      now: 90_000,
    }),
  );
  assert.ok(fresh[3].includes("20s"));
  assert.ok(!fresh[3].includes("~20s"));
});

// ── PI-21: tabular alignment ────────────────────────────

test("layoutColumns right-aligns numeric cells to widest cell", () => {
  const lines = layoutColumns(
    [
      ["a", "9s", "6t"],
      ["bb", "12m30s", "0t"],
    ],
    [1, 2],
    40,
  );
  assert.equal(lines.length, 2);
  assert.equal(lines[0], "a       9s  6t");
  assert.equal(lines[1], "bb  12m30s  0t");
});

test("agent rows: elapsed cells have equal visibleWidth when same stage width", () => {
  // Two coder agents (same stage → identical col0 width) with different elapsed.
  // Fresh at times (no ~ stale prefix) so the elapsed cells are right-aligned
  // to the widest elapsed cell ("1m39s" = 5) → both cells are 5 wide.
  const result = renderStatusWidget(
    state({
      agents: [
        agent({
          stage: "coder",
          startedAt: 91_000,
          at: 91_000,
          turns: 6,
          context: { kind: "measured", percent: 7 },
        }),
        agent({
          stage: "coder",
          startedAt: 1_000,
          at: 91_000,
          turns: 0,
          context: { kind: "unknown" },
        }),
      ],
      now: 100_000,
    }),
  );
  assert.equal(result.length, 5); // 3 base + 2 agents
  // Both rows: col0 = "◉ coder" (7 chars, visible width 8) + 2-space gutter → elapsed starts at char 9
  const row0 = result[3];
  const row1 = result[4];
  assert.equal(row0.slice(9, 14), "   9s"); // 3 spaces + 9s, right-aligned to width 5
  assert.equal(row1.slice(9, 14), "1m39s"); // 1m39s already width 5
  assert.equal(
    visibleWidth(row0.slice(9, 14)),
    visibleWidth(row1.slice(9, 14)),
  );
});

test("deterministic: same state produces byte-identical lines", () => {
  const s = state({
    mode: "free",
    route: { mode: "fleet", stage: "coder" },
    activeStage: "coder",
    workflowStatus: "running",
    agents: [agent()],
    now: 100_000,
  });
  const a = renderStatusWidget(s);
  const b = renderStatusWidget(s);
  assert.deepEqual(a, b);
});

// ── PI-21: INV-11 no meaning by colour alone ────────────

test("INV-11: four glyphs ✓◉·× are distinguishable without colour", () => {
  const result = renderStatusWidget(
    state({
      activeStage: "coder",
      workflowStatus: "running",
      agents: [
        agent({ stage: "planner", status: "done" }),
        agent({ stage: "coder", status: "running" }),
        agent({ stage: "debugger", status: "error" }),
        agent({ stage: "reviewer", status: "running" }),
      ],
      now: 100_000,
    }),
  );
  const all = result.join(" ");
  assert.ok(all.includes("✓"), "done glyph ✓ present");
  assert.ok(all.includes("◉"), "active glyph ◉ present");
  assert.ok(all.includes("·"), "pending glyph · present");
  assert.ok(all.includes("×"), "error glyph × present");
  // No ANSI escapes in output
  assert.ok(!all.includes("\u001b"));
});

// ── PI-21: INV-2 secret redaction ───────────────────────

test("INV-2: secret-shaped tokens in model/backend are redacted", () => {
  const result = renderStatusWidget(
    state({
      agents: [
        agent({
          model: "sk-secretapikey1234567890",
          backend: "sk-another-secret-key-here",
        }),
      ],
      width: 100,
      now: 100_000,
    }),
  );
  assert.ok(result[3].includes("[REDACTED]"));
  assert.ok(!result[3].includes("sk-secretapikey1234567890"));
});

test("INV-2: terminal control chars stripped from token values", () => {
  const result = renderStatusWidget(
    state({
      agents: [agent({ model: "safe\u001b[31mred\u001b[0mmodel" })],
      width: 100,
      now: 100_000,
    }),
  );
  assert.ok(result[3].includes("saferedmodel"));
  assert.ok(!result[3].includes("\u001b[31m"));
});

test("INV-2: input lines with secret patterns are redacted", () => {
  const secret = renderStatusWidget(
    state({ inputLines: ["api_key=my-secret-key-value"] }),
  );
  assert.ok(secret[3].includes("[REDACTED]"));
  assert.ok(!secret[3].includes("my-secret-key-value"));

  const token = renderStatusWidget(
    state({ inputLines: ["sk-abcdefghijklmnopqrstuvwx"] }),
  );
  assert.ok(token[3].includes("[REDACTED]"));

  const plain = renderStatusWidget(state({ inputLines: ["plain text line"] }));
  assert.equal(plain[3], "plain text line");
});

// ── PI-21: width bounds with agents ─────────────────────

test("PI-20 width bounds hold with agent rows at 40, 80, 120, 200", () => {
  const agents = [
    agent({ stage: "planner", status: "done" }),
    agent({ stage: "coder", status: "running" }),
    agent({ stage: "debugger", status: "done" }),
    agent({ stage: "reviewer", status: "running" }),
  ];
  for (const width of [40, 80, 120, 200]) {
    const result = renderStatusWidget(state({ agents, width, now: 100_000 }));
    for (const line of result) {
      assert.ok(
        visibleWidth(line) <= width,
        `width ${width}: line "${line}" has visible width ${visibleWidth(line)}`,
      );
    }
  }
});

test("1000 renders with agents at width 200 complete in under 2000ms", () => {
  const s = state({
    agents: [
      agent({ stage: "planner", status: "done" }),
      agent({ stage: "coder", status: "running" }),
      agent({ stage: "debugger", status: "error" }),
      agent({ stage: "reviewer", status: "running" }),
    ],
    width: 200,
    now: 100_000,
  });
  const start = Date.now();
  for (let i = 0; i < 1000; i++) {
    renderStatusWidget(s);
  }
  const elapsed = Date.now() - start;
  assert.ok(
    elapsed < 2000,
    `1000 renders took ${elapsed}ms, expected < 2000ms`,
  );
});

// ── PI-21: INV-1 no 0% ──────────────────────────────────

test("INV-1: no 0% appears anywhere in output", () => {
  const result = renderStatusWidget(
    state({
      agents: [
        agent({ context: { kind: "unknown" } }),
        agent({ context: { kind: "measured", percent: 0.5 } }),
        agent({ stage: "debugger", context: { kind: "measured", percent: 7 } }),
      ],
      now: 100_000,
    }),
  );
  const all = result.join(" ");
  assert.ok(!all.includes("0%"), "output contains no 0%");
  assert.ok(all.includes("? ctx"));
  assert.ok(all.includes("<1% ctx"));
  assert.ok(all.includes("7% ctx"));
});

// ── PI-23: issue rows ───────────────────────────────────

test("PI-23: N issue records render N rows after the issues rule", () => {
  const result = renderStatusWidget(
    state({
      ticketSnapshot: snapshot([
        issue({ id: "PI-20", status: "done", assignee: "reviewer" }),
        issue({
          id: "PI-21",
          status: "agent-ready",
          assignee: "coder",
          title: "rich mode/route/stage rows",
        }),
        issue({
          id: "PI-23",
          status: "coding",
          assignee: "coder",
          title: "issue rows in the widget",
        }),
        issue({ id: "PI-22", status: "done", assignee: "reviewer" }),
      ]),
      now: 100_000,
    }),
  );
  // 3 base + issues rule + 2 displayed rows (done excluded) = 6
  assert.equal(result.length, 6);
  assert.match(result[3], /issues · 2 active · 2 done/);
  // Rows ordered: agent-ready before coding; done excluded
  const idx21 = result.findIndex((l) => l.includes("PI-21"));
  const idx23 = result.findIndex((l) => l.includes("PI-23"));
  assert.ok(idx21 >= 0 && idx23 >= 0, "both active rows present");
  assert.ok(idx21 < idx23, "agent-ready sorts before coding");
  assert.ok(
    result.find((l) => l.includes("PI-20")) === undefined,
    "done excluded",
  );
  assert.ok(
    result.find((l) => l.includes("PI-22")) === undefined,
    "done excluded",
  );
});

test("PI-23: each row shows id, short status token, assignee, title, blocker summary", () => {
  const result = renderStatusWidget(
    state({
      width: 100,
      ticketSnapshot: snapshot([
        issue({
          id: "PI-21",
          status: "agent-ready",
          assignee: "coder",
          title: "rich mode/route/stage rows",
          blockedBy: [{ id: "PI-20", satisfied: true }],
          blocking: "unblocked",
        }),
        issue({
          id: "PI-23",
          status: "planned",
          assignee: "planner",
          title: "issue rows in the widget",
          blockedBy: [{ id: "PI-21", satisfied: false }],
          blocking: "blocked",
        }),
      ]),
      now: 100_000,
    }),
  );
  const row21 = result.find((l) => l.includes("PI-21"));
  const row23 = result.find((l) => l.includes("PI-23"));
  assert.ok(row21, "PI-21 row present");
  assert.ok(row23, "PI-23 row present");
  assert.ok(row21!.includes("ready"), "short status token ready");
  assert.ok(row21!.includes("coder"), "assignee coder");
  assert.ok(row21!.includes("rich mode/route/stage rows"), "title");
  assert.ok(row21!.includes("PI-20 ✓"), "satisfied blocker glyph ✓");
  assert.ok(row23!.includes("planned"), "status planned");
  assert.ok(row23!.includes("planner"), "assignee planner");
  assert.ok(row23!.includes("PI-21 ·"), "unsatisfied blocker glyph ·");
});

test("PI-23: no blockers renders 'blk none'", () => {
  const result = renderStatusWidget(
    state({
      ticketSnapshot: snapshot([
        issue({ blockedBy: [], blocking: "unblocked" }),
      ]),
      now: 100_000,
    }),
  );
  const row = result.find((l) => l.includes("PI-23"));
  assert.ok(row && row.includes("blk none"));
});

test("PI-23: stale snapshot renders ~ + age in the issues rule", () => {
  // capturedAt 50_000, now 90_000 → 40s > 30s stale window
  const stale = renderStatusWidget(
    state({
      ticketSnapshot: snapshot([issue()], { capturedAt: 50_000 }),
      now: 90_000,
    }),
  );
  assert.match(stale[3], /~40s/);

  // Fresh: capturedAt 70_000, now 90_000 → 20s <= 30s
  const fresh = renderStatusWidget(
    state({
      ticketSnapshot: snapshot([issue()], { capturedAt: 70_000 }),
      now: 90_000,
    }),
  );
  assert.doesNotMatch(fresh[3], /~/);
});

test("PI-23: absent or reason-carrying snapshot renders unavailable — <reason>", () => {
  // No snapshot provided → no issues section (surface stays minimal).
  const absent = renderStatusWidget(
    state({ ticketSnapshot: undefined, now: 100_000 }),
  );
  assert.equal(absent.length, 3); // base only
  assert.equal(
    absent.find((l) => l.includes("issues")),
    undefined,
  );

  const timedOut = renderStatusWidget(
    state({
      ticketSnapshot: snapshot([], { reason: "timeout" }),
      now: 100_000,
    }),
  );
  assert.ok(timedOut[3].includes("issues unavailable — timeout"));

  const empty = renderStatusWidget(
    state({ ticketSnapshot: snapshot([]), now: 100_000 }),
  );
  // Empty records still show the rule (0 active · 0 done)
  assert.equal(empty.length, 4);
  assert.match(empty[3], /issues · 0 active · 0 done/);
});

test("PI-23: a 200-ticket snapshot respects maxLines with correct overflow", () => {
  const records = Array.from({ length: 200 }, (_, i) =>
    issue({ id: `PI-${i + 1}`, status: "coding" }),
  );
  const result = renderStatusWidget(
    state({
      ticketSnapshot: snapshot(records),
      maxLines: 40,
      now: 100_000,
    }),
  );
  // 3 base + 1 rule + 200 rows = 204 > 40 → 40 lines with overflow
  assert.equal(result.length, 40);
  assert.ok(result[39].includes("more · /flow"));
});

test("PI-23: at width 50 rows collapse to id + status + blocker summary", () => {
  const result = renderStatusWidget(
    state({
      width: 50,
      ticketSnapshot: snapshot([
        issue({
          id: "PI-23",
          status: "coding",
          title: "a very long title that should be dropped in collapsed mode",
          assignee: "coder",
          blockedBy: [{ id: "PI-21", satisfied: false }],
          blocking: "blocked",
        }),
      ]),
      now: 100_000,
    }),
  );
  const row = result.find((l) => l.includes("PI-23"));
  assert.ok(row, "row present");
  assert.ok(row!.includes("coding"), "status present");
  assert.ok(row!.includes("blk PI-21 ·"), "blocker summary present");
  assert.ok(!row!.includes("collapsed mode"), "title dropped");
  assert.ok(visibleWidth(row!) <= 50);
});

test("PI-23: width bounds hold with issue rows at 40, 80, 120, 200", () => {
  const records = [
    issue({
      id: "PI-21",
      status: "coding",
      assignee: "coder",
      title:
        "rich mode/route/stage rows with a very long title that needs truncation",
      blockedBy: [{ id: "PI-20", satisfied: true }],
      blocking: "unblocked",
    }),
    issue({
      id: "PI-23",
      status: "planned",
      assignee: "planner",
      title: "issue rows in the belowEditor surface widget",
    }),
  ];
  for (const width of [40, 80, 120, 200]) {
    const result = renderStatusWidget(
      state({ ticketSnapshot: snapshot(records), width, now: 100_000 }),
    );
    for (const line of result) {
      assert.ok(
        visibleWidth(line) <= width,
        `width ${width}: "${line}" has visible width ${visibleWidth(line)}`,
      );
    }
  }
});

test("PI-23: deterministic rendering is byte-identical for same input", () => {
  const s = state({
    ticketSnapshot: snapshot([
      issue({ id: "PI-21", status: "coding" }),
      issue({ id: "PI-23", status: "planned" }),
    ]),
    now: 100_000,
  });
  assert.deepEqual(renderStatusWidget(s), renderStatusWidget(s));
});

test("PI-23: title redaction strips secrets and control chars (INV-2)", () => {
  const result = renderStatusWidget(
    state({
      ticketSnapshot: snapshot([
        issue({ title: "fix auth api_key=super-secret-key-value 123" }),
      ]),
      now: 100_000,
    }),
  );
  const all = result.join(" ");
  assert.ok(!all.includes("super-secret-key-value"), "secret redacted");
  assert.ok(all.includes("[REDACTED]"));

  const ctl = renderStatusWidget(
    state({
      ticketSnapshot: snapshot([
        issue({ title: "safe\u001b[31mred\u001b[0mtitle" }),
      ]),
      now: 100_000,
    }),
  );
  assert.ok(!ctl.join(" ").includes("\u001b[31m"));
  assert.ok(ctl.join(" ").includes("saferedtitle"));
});

test("PI-23: throwing snapshot getter returns bounded base lines (INV-6)", () => {
  const throwing = {
    width: 80,
    maxLines: 40,
    inputLines: [],
    get ticketSnapshot(): StatusWidgetSnapshotView | undefined {
      throw new Error("boom");
    },
  } satisfies StatusWidgetState;
  const result = renderStatusWidget(throwing);
  assert.equal(result.length, 3);
  assert.match(result[0], /flow/);
  assert.match(result[1], /mode.*route/);
  assert.match(result[2], /planner.*coder.*debugger.*reviewer/);
});

test("PI-23: issue rows cannot throw on malformed record fields", () => {
  const result = renderStatusWidget(
    state({
      ticketSnapshot: {
        capturedAt: 100_000,
        records: [
          {
            id: Symbol("bad") as never,
            title: "title",
            status: "coding",
            blockedBy: null as never,
            blocking: "blocked",
          },
        ],
      },
      now: 100_000,
    }),
  );
  assert.ok(Array.isArray(result));
  assert.ok(result.length >= 4);
});

test("PI-23: 1000 renders with 200 issue rows at width 200 complete under 2000ms", () => {
  const records = Array.from({ length: 200 }, (_, i) =>
    issue({ id: `PI-${i + 1}`, status: "coding" }),
  );
  const s = state({
    ticketSnapshot: snapshot(records),
    width: 200,
    now: 100_000,
  });
  const start = Date.now();
  for (let i = 0; i < 1000; i++) {
    renderStatusWidget(s);
  }
  const elapsed = Date.now() - start;
  assert.ok(
    elapsed < 2000,
    `1000 renders took ${elapsed}ms, expected < 2000ms`,
  );
});

// ── Debugger PI-23: INV-2 redaction of all user-controlled cells ──

test("PI-23 debugger: INV-2 secret-shaped assignee redacted, control chars stripped", () => {
  const result = renderStatusWidget(
    state({
      ticketSnapshot: snapshot([
        issue({
          assignee: "sk-abc12345678901234567890",
        }),
        issue({
          id: "PI-24",
          assignee: "coder\u001b[31mhacked\u001b[0m",
        }),
      ]),
      now: 100_000,
    }),
  );
  const all = result.join(" ");
  assert.ok(
    !all.includes("sk-abc12345678901234567890"),
    "secret-shaped assignee redacted",
  );
  assert.ok(!all.includes("\u001b[31m"), "ANSI escape stripped from assignee");
});

test("PI-23 debugger: INV-2 control chars stripped from status and id", () => {
  const result = renderStatusWidget(
    state({
      ticketSnapshot: snapshot([
        issue({
          id: "PI-\u001b[31mXSS\u001b[0m",
          status: "\u001b[31mcoding\u001b[0m",
        }),
      ]),
      now: 100_000,
    }),
  );
  const all = result.join(" ");
  assert.ok(!all.includes("\u001b[31m"), "ANSI escape stripped from id/status");
  assert.ok(!all.includes("XSS"), "control-stripped id text may vanish");
});

test("PI-23 debugger: INV-2 blocker id redacted for secret patterns", () => {
  const result = renderStatusWidget(
    state({
      ticketSnapshot: snapshot([
        issue({
          blockedBy: [{ id: "sk-abc12345678901234567890", satisfied: false }],
          blocking: "blocked",
        }),
      ]),
      now: 100_000,
    }),
  );
  const all = result.join(" ");
  assert.ok(
    !all.includes("sk-abc12345678901234567890"),
    "secret-shaped blocker id redacted",
  );
});

test("PI-23 debugger: INV-2 control chars stripped from blocker id", () => {
  const result = renderStatusWidget(
    state({
      ticketSnapshot: snapshot([
        issue({
          blockedBy: [{ id: "PI-\u001b[31mXSS\u001b[0m", satisfied: false }],
          blocking: "blocked",
        }),
      ]),
      now: 100_000,
    }),
  );
  const all = result.join(" ");
  assert.ok(!all.includes("\u001b[31m"), "ANSI stripped from blocker id");
});

// ── Debugger PI-23: INV-6 per-record isolation ──

test("PI-23 debugger: one malformed record does not nuke all issue rows", () => {
  const result = renderStatusWidget(
    state({
      ticketSnapshot: snapshot([
        issue({ id: "PI-21", status: "agent-ready", assignee: "coder" }),
        // Malformed: null blockedBy causes blockerSummary to throw
        {
          id: "PI-42",
          title: "bad record",
          status: "coding",
          assignee: "coder",
          blockedBy: null as never,
          blocking: "blocked",
        },
        issue({ id: "PI-23", status: "planned", assignee: "planner" }),
      ]),
      now: 100_000,
    }),
  );
  // Good rows still render
  assert.ok(
    result.find((l) => l.includes("PI-21")),
    "PI-21 row present",
  );
  assert.ok(
    result.find((l) => l.includes("PI-23")),
    "PI-23 row present",
  );
  // No "issues unavailable" degradation
  assert.ok(
    !result.find((l) => l.includes("issues unavailable")),
    "no section-wide degradation",
  );
});

test("PI-23 debugger: null blockedBy record renders as normal row with blk none", () => {
  const result = renderStatusWidget(
    state({
      ticketSnapshot: snapshot([
        {
          id: "PI-42",
          title: "bad",
          status: "coding",
          assignee: "coder",
          blockedBy: null as never,
          blocking: "blocked",
        },
      ]),
      now: 100_000,
    }),
  );
  // Row renders with null blockedBy handled as blk none
  assert.ok(
    result.find((l) => l.includes("PI-42")),
    "PI-42 row present",
  );
  assert.ok(
    result.find((l) => l.includes("blk none")),
    "blk none present",
  );
});

// ── Debugger PI-23: empty title placeholder (INV-10) ──

test("PI-23 debugger: empty title renders '\u2014' placeholder", () => {
  const result = renderStatusWidget(
    state({
      width: 100,
      ticketSnapshot: snapshot([
        issue({ id: "PI-23", title: "", assignee: "planner" }),
      ]),
      now: 100_000,
    }),
  );
  const row = result.find((l) => l.includes("PI-23"));
  assert.ok(row, "row present");
  assert.ok(row!.includes("\u2014"), "em-dash placeholder for empty title");
});

// ── Debugger PI-23: only-done records ──

test("PI-23 debugger: only-done records show in rule but no rows", () => {
  const result = renderStatusWidget(
    state({
      ticketSnapshot: snapshot([
        issue({ id: "PI-20", status: "done", assignee: "reviewer" }),
        issue({ id: "PI-08", status: "dropped", assignee: "reviewer" }),
      ]),
      now: 100_000,
    }),
  );
  assert.equal(result.length, 4); // 3 base + 1 rule
  assert.match(result[3], /issues · 0 active · 2 done/);
  assert.ok(!result.find((l) => l.includes("PI-20")), "done excluded");
});

// ── Debugger PI-23: only-active records ──

test("PI-23 debugger: only-active records all show", () => {
  const result = renderStatusWidget(
    state({
      ticketSnapshot: snapshot([
        issue({ id: "PI-21", status: "coding", assignee: "coder" }),
        issue({ id: "PI-23", status: "planned", assignee: "planner" }),
      ]),
      now: 100_000,
    }),
  );
  assert.ok(
    result.find((l) => l.includes("PI-21")),
    "PI-21 present",
  );
  assert.ok(
    result.find((l) => l.includes("PI-23")),
    "PI-23 present",
  );
  assert.equal(result.length, 6); // 3 base + 1 rule + 2 rows
});

// ── Debugger PI-23: wide glyphs at small width ──

test("PI-23 debugger: wide glyphs (CJK) in title at width 60 are width-safe", () => {
  const result = renderStatusWidget(
    state({
      width: 60,
      ticketSnapshot: snapshot([
        issue({
          id: "PI-23",
          title:
            "\u5df2\u6839\u636e\u9700\u6c42\u6dfb\u52a0\u4e86\u4e2d\u6587\u6807\u9898\u548c\u5bbd\u655e\u7684\u7a7a\u767d",
          assignee: "coder",
          blockedBy: [{ id: "PI-21", satisfied: true }],
          blocking: "unblocked",
        }),
      ]),
      now: 100_000,
    }),
  );
  for (const line of result) {
    assert.ok(
      visibleWidth(line) <= 60,
      `line "${line}" has visible width ${visibleWidth(line)}`,
    );
  }
});

test("PI-23 debugger: wide glyphs in collapsed mode at width 50", () => {
  const result = renderStatusWidget(
    state({
      width: 50,
      ticketSnapshot: snapshot([
        issue({
          id: "PI-23",
          title: "\u2713 \u25c9 \u00b7 \u00d7 \u5bbd \u5df2 \u6d4b",
          assignee: "coder",
        }),
      ]),
      now: 100_000,
    }),
  );
  for (const line of result) {
    assert.ok(
      visibleWidth(line) <= 50,
      `line "${line}" has visible width ${visibleWidth(line)}`,
    );
  }
});

// ── PI-31 routines section ──────────────────────────────

function routine(
  overrides: Partial<StatusWidgetRoutineRecord> = {},
): StatusWidgetRoutineRecord {
  return {
    name: "standup",
    schedule: "every 60m",
    enabled: true,
    dueAt: 100_000,
    ...overrides,
  };
}

test("PI-31: routines section renders name + status token rows deterministically", () => {
  const r1 = routine({
    name: "standup",
    schedule: "every 60m",
    dueAt: 100_000,
  });
  const r2 = routine({
    name: "weekly",
    schedule: "daily at 9:00",
    enabled: false,
    dueAt: 100_000,
  });
  const a = renderStatusWidget(state({ now: 100_000, routines: [r1, r2] }));
  const b = renderStatusWidget(state({ now: 100_000, routines: [r1, r2] }));
  assert.deepEqual(a, b);
  const joined = a.join("\n");
  assert.match(joined, /standup/);
  assert.match(joined, /weekly/);
  assert.match(joined, /disabled/);
  assert.match(joined, /─ routines/);
});

test("PI-31: due-now and snoozed tokens per state", () => {
  const dueNow = renderStatusWidget(
    state({ now: 100_000, routines: [routine({ dueAt: 100_000 })] }),
  ).join("\n");
  assert.match(dueNow, /due now/);
  const snoozed = renderStatusWidget(
    state({
      now: 100_000,
      routines: [routine({ snoozedUntil: 100_000 + 30 * 60_000 })],
    }),
  ).join("\n");
  assert.match(snoozed, /snoozed/);
});

test("PI-31: no routines / undefined source → no section, no crash", () => {
  const none = renderStatusWidget(state({ now: 100_000 }));
  assert.ok(!none.join("\n").includes("routines"));
  const empty = renderStatusWidget(state({ now: 100_000, routines: [] }));
  assert.ok(!empty.join("\n").includes("routines"));
});

test("PI-31: widths 40/80/120/200 bounded, overflow via maxLines budget", () => {
  for (const width of [40, 80, 120, 200]) {
    const rows = Array.from({ length: 30 }, (_, i) =>
      routine({ name: `routine-${i}`, dueAt: 100_000 }),
    );
    const result = renderStatusWidget(
      state({ width, maxLines: 12, now: 100_000, routines: rows }),
    );
    assert.ok(result.length <= 12, `width ${width}: lines ${result.length}`);
    for (const line of result) {
      assert.ok(
        visibleWidth(line) <= width,
        `width ${width}: line "${line}" has visible width ${visibleWidth(line)}`,
      );
    }
    const joined = result.join("\n");
    if (rows.length > 12) assert.match(joined, /more · \/flow/);
  }
});

test("PI-31: user text redacted; throwing routine getter → bounded fallback", () => {
  const secret = "ghp_abcdef1234567890";
  const result = renderStatusWidget(
    state({ now: 100_000, routines: [routine({ name: secret })] }),
  );
  assert.ok(!result.join("\n").includes(secret));
  const throwing = state({ now: 100_000 });
  Object.defineProperty(throwing, "routines", {
    get() {
      throw new Error("boom");
    },
  });
  const fallback = renderStatusWidget(throwing);
  assert.ok(Array.isArray(fallback));
  assert.ok(fallback.length >= 0);
});

// ── Debugger PI-31: non-finite dueAt, per-row isolation, future dueAt ──

test("PI-31 debugger: NaN dueAt never leaks into output", () => {
  const result = renderStatusWidget(
    state({ now: 100_000, routines: [routine({ dueAt: Number.NaN })] }),
  );
  const all = result.join(" ");
  assert.ok(!all.includes("NaN"), "NaN dueAt produces no NaN");
  assert.ok(!all.includes("Infinity"), "NaN dueAt produces no Infinity");
});

test("PI-31 debugger: -Infinity dueAt never leaks into output", () => {
  const result = renderStatusWidget(
    state({
      now: 100_000,
      routines: [routine({ dueAt: Number.NEGATIVE_INFINITY })],
    }),
  );
  const all = result.join(" ");
  assert.ok(!all.includes("Infinity"), "-Infinity dueAt produces no Infinity");
  assert.ok(!all.includes("NaN"), "-Infinity dueAt produces no NaN");
});

test("PI-31 debugger: null entry in routines array does not drop the section", () => {
  const result = renderStatusWidget(
    state({
      now: 100_000,
      routines: [
        null,
        routine({ name: "good", dueAt: 100_000 }),
      ] as never as readonly StatusWidgetRoutineRecord[],
    }),
  );
  const all = result.join(" ");
  assert.ok(all.includes("good"), "good row still renders alongside null");
  assert.ok(all.includes("routines"), "section rule still renders");
});

test("PI-31 debugger: future dueAt does not appear as due", () => {
  const result = renderStatusWidget(
    state({
      now: 100_000,
      routines: [routine({ name: "future", dueAt: 200_000 })],
    }),
  );
  const all = result.join(" ");
  assert.ok(!all.includes("future"), "future-due routine hidden from section");
});

test("PI-31 debugger: undefined dueAt does not crash", () => {
  const result = renderStatusWidget(
    state({
      now: 100_000,
      routines: [
        {
          name: "missing",
          schedule: "every 60m",
          enabled: true,
        } as StatusWidgetRoutineRecord,
      ],
    }),
  );
  const all = result.join(" ");
  assert.ok(!all.includes("NaN"), "undefined dueAt produces no NaN");
  assert.ok(!all.includes("Infinity"), "undefined dueAt produces no Infinity");
});
