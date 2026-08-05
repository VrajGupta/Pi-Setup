import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderStatusWidget, type StatusWidgetState } from "./status-widget.ts";

function state(overrides: Partial<StatusWidgetState> = {}): StatusWidgetState {
  return {
    width: 80,
    maxLines: 40,
    inputLines: [],
    ...overrides,
  };
}

test("with 0 input lines, renders 0 lines", () => {
  assert.deepEqual(renderStatusWidget(state({ inputLines: [] })), []);
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
  const result = renderStatusWidget(state({ inputLines, maxLines: 1_000_000 }));
  assert.equal(result.length, 200);
  assert.ok(result[199].includes("+51 more · /flow"));
});

test("maxLines defaults to 40 when missing or invalid", () => {
  const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`);
  const result = renderStatusWidget(
    state({ inputLines: lines, maxLines: undefined }),
  );
  assert.equal(result.length, 40);
  assert.ok(result[39].includes("+11 more · /flow"));
});

test("every line has visible width ≤ requested width at 40, 80, 120, 200", () => {
  const lines = Array.from(
    { length: 50 },
    (_, i) =>
      `line ${i + 1} with some extra long content to test width clipping across different widths`,
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

test("overflow line format is exactly '+N more · /flow'", () => {
  const test1 = renderStatusWidget(
    state({ inputLines: Array(50).fill("line"), maxLines: 10 }),
  );
  assert.equal(test1.length, 10);
  assert.ok(test1[9].includes("+41 more · /flow"));

  const test2 = renderStatusWidget(
    state({ inputLines: Array(101).fill("line"), maxLines: 50 }),
  );
  assert.equal(test2.length, 50);
  assert.ok(test2[49].includes("+52 more · /flow"));
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
