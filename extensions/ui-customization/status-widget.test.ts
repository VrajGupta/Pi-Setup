import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import uiCustomization from "./index.ts";
import { renderStatusWidget, type StatusWidgetState } from "./status-widget.ts";

function state(overrides: Partial<StatusWidgetState> = {}): StatusWidgetState {
  return {
    width: 80,
    maxLines: 40,
    inputLines: [],
    ...overrides,
  };
}

test("with 0 input lines, renders the three base lines", () => {
  const result = renderStatusWidget(state({ inputLines: [] }));
  assert.equal(result.length, 3);
  assert.match(result[0], /flow/);
  assert.match(result[1], /mode.*route/);
  assert.match(result[2], /planner.*coder.*debugger.*reviewer/);
});

test("with N input lines where N < maxLines, renders exactly N lines", () => {
  const lines = ["line 1", "line 2", "line 3"];
  const result = renderStatusWidget(state({ inputLines: lines }));
  assert.equal(result.length, 3);
  assert.deepEqual(result, lines);
});

test("with N input lines where N === maxLines, renders exactly N lines", () => {
  const lines = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`);
  const result = renderStatusWidget(state({ inputLines: lines, maxLines: 40 }));
  assert.equal(result.length, 40);
  assert.deepEqual(
    result,
    renderStatusWidget(state({ inputLines: lines, maxLines: 40 })),
  );
});

test("with N input lines where N > maxLines, renders maxLines total lines including overflow", () => {
  const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`);
  const result = renderStatusWidget(state({ inputLines: lines, maxLines: 40 }));
  assert.equal(result.length, 40);
  assert.ok(result[39].includes("+11 more · /flow"));
});

test("maxLines clamps to minimum 8 when passed 0, negative, or NaN", () => {
  const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);

  const zeroResult = renderStatusWidget(
    state({ inputLines: lines, maxLines: 0 }),
  );
  assert.equal(zeroResult.length, 8);
  assert.ok(zeroResult[7].includes("+93 more · /flow"));

  const negResult = renderStatusWidget(
    state({ inputLines: lines, maxLines: -100 }),
  );
  assert.equal(negResult.length, 8);

  const nanResult = renderStatusWidget(
    state({ inputLines: lines, maxLines: NaN }),
  );
  assert.equal(nanResult.length, 8);
});

test("maxLines clamps to maximum 200 when passed very large values", () => {
  const inputLines = Array.from({ length: 250 }, (_, i) => `line ${i + 1}`);
  const result = renderStatusWidget(state({ inputLines, maxLines: 1e9 }));
  assert.equal(result.length, 200);
  assert.ok(result[199].includes("+51 more · /flow"));
});

test("maxLines defaults to 40 when missing or non-numeric", () => {
  const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`);
  for (const maxLines of [undefined, "not-a-number"]) {
    const result = renderStatusWidget(
      state({ inputLines: lines, maxLines: maxLines as never }),
    );
    assert.equal(result.length, 40);
    assert.ok(result[39].includes("+11 more · /flow"));
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
  const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
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
  const exact = renderStatusWidget(
    state({ inputLines: Array(10).fill("line"), maxLines: 10 }),
  );
  assert.equal(exact.length, 10);
  assert.doesNotMatch(exact[9], /more · \/flow/);

  const oneOver = renderStatusWidget(
    state({ inputLines: Array(11).fill("line"), maxLines: 10 }),
  );
  assert.equal(oneOver.length, 10);
  assert.equal(oneOver[9], "+2 more · /flow");

  const many = renderStatusWidget(
    state({ inputLines: Array(50).fill("line"), maxLines: 10 }),
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
  const lines = [
    "plain string",
    123 as never, // number coerced to string
  ];
  const result = renderStatusWidget(
    state({ inputLines: lines as readonly string[] }),
  );
  assert.equal(result.length, 2);
  assert.equal(result[0], "plain string");
  assert.equal(result[1], "123");
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
