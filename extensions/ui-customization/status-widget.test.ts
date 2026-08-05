import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import uiCustomization from "./index.ts";
import {
  layoutColumns,
  renderStatusWidget,
  type StatusWidgetAgent,
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

test("maxLines clamps to minimum 8 when passed 0 or negative", () => {
  const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);

  const zeroResult = renderStatusWidget(
    state({ inputLines: lines, maxLines: 0 }),
  );
  assert.equal(zeroResult.length, 8);
  assert.ok(zeroResult[7].includes("+96 more · /flow"));

  const negResult = renderStatusWidget(
    state({ inputLines: lines, maxLines: -100 }),
  );
  assert.equal(negResult.length, 8);
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

  uiCustomization(pi as never);
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
