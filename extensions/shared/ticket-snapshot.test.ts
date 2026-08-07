import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  isValidTicketSnapshot,
  parseTicketSnapshot,
} from "./ticket-snapshot.ts";

const capture = { repo: "VrajGupta/Pi-Setup", capturedAt: 1_000 };

function ticket(id: string, status: string, extra = "") {
  return `## ${id} — ${id} title\n\nStatus: **${status}**${extra}\n`;
}

test("parses this tracker into frozen records without I/O or input mutation", () => {
  const source = readFileSync(
    new URL("../../tickets.md", import.meta.url),
    "utf8",
  );
  const snapshot = parseTicketSnapshot(source, capture);
  const headings = [...source.matchAll(/^## (PI-\d+) /gm)];

  // Counts are derived from the tracker, never pinned to a magic total: adding a
  // ticket must change the count rather than fail this test, and no record may be
  // deleted from the tracker to make a hard-coded number line up.
  assert.equal(snapshot.reason, undefined);
  assert.ok(headings.length > 0);
  assert.equal(snapshot.records.length, headings.length);
  assert.deepEqual(
    snapshot.records.map(({ id }) => id),
    headings.map((heading) => heading[1]),
  );
  assert.equal(
    new Set(snapshot.records.map(({ id }) => id)).size,
    snapshot.records.length,
  );
  // Board-mapped history (PI-06..PI-39) and pre-board local history (PI-01..PI-05)
  // both survive; the latter is completed work with no GitHub issue number.
  for (const id of ["PI-01", "PI-02", "PI-04", "PI-05"]) {
    assert.equal(
      snapshot.records.find((record) => record.id === id)?.status,
      "done",
    );
  }
  assert.equal(
    snapshot.records.find(({ id }) => id === "PI-03")?.status,
    "dropped",
  );
  // The stale Review Ready rows #40 was filed against are gone.
  assert.equal(
    snapshot.records.find(({ id }) => id === "PI-28")?.status,
    "done",
  );
  assert.equal(
    snapshot.records.find(({ id }) => id === "PI-31")?.status,
    "done",
  );
  assert.equal(
    snapshot.records.find(({ id }) => id === "PI-39")?.status,
    "done",
  );
  assert.equal(
    snapshot.records.some(({ status }) => status === "review-ready"),
    false,
  );
  assert.deepEqual(
    snapshot.records.find(({ id }) => id === "PI-13")?.blockedBy,
    [{ id: "PI-11", satisfied: true }],
  );
  const pi13 = snapshot.records.find(({ id }) => id === "PI-13");
  assert.equal(
    pi13?.title,
    "Tracker snapshot source and honest ETA estimator (pure module, INV-9)",
  );
  assert.equal(
    pi13?.verificationCommand,
    "node --test --experimental-strip-types extensions/shared/ticket-snapshot.test.ts && npm run check",
  );
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.records), true);
  assert.ok(snapshot.records.every((record) => Object.isFrozen(record)));
  assert.ok(
    snapshot.records.every(
      (record) =>
        Object.isFrozen(record.blockedBy) &&
        record.blockedBy.every((blocker) => Object.isFrozen(blocker)),
    ),
  );
  assert.ok(snapshot.records.every((record) => Object.isFrozen(record.eta)));
  assert.equal(Reflect.set(snapshot.records, 0, snapshot.records[0]), false);
  assert.equal(Reflect.set(snapshot.records[0]!, "title", "mutated"), false);
  assert.equal(
    Reflect.set(snapshot.records[0]!.eta, "kind", "estimated"),
    false,
  );

  const moduleSource = readFileSync(
    new URL("./ticket-snapshot.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    moduleSource,
    /from\s+["']node:(fs|child_process|http|https|net)/,
  );
  assert.doesNotMatch(moduleSource, /\b(fetch|XMLHttpRequest|WebSocket)\s*\(/);
});

test("fails closed on empty or malformed tracker data and only emits role assignees", () => {
  assert.deepEqual(parseTicketSnapshot("", capture), {
    repo: "VrajGupta/Pi-Setup",
    capturedAt: 1_000,
    records: [],
    reason: "empty tracker",
  });
  assert.equal(
    parseTicketSnapshot("## PI-13", capture).reason,
    "no complete ticket headings",
  );

  const valid = parseTicketSnapshot(
    [
      ticket("PI-01", "Coding", " · Assignee: **reviewer**"),
      ticket("PI-02", "Done", "\n\nAssignee: deployer"),
    ].join("\n"),
    capture,
  );
  assert.deepEqual(
    valid.records.map(({ status, assignee }) => ({ status, assignee })),
    [
      { status: "coding", assignee: "reviewer" },
      { status: "done", assignee: "reviewer" },
    ],
  );

  const malformed = parseTicketSnapshot(
    [
      ticket("PI-03", "not a pipeline status"),
      "## PI-04 — missing status\n",
      "## PI-05 — malformed status\n\nStatus: **Done** unexpected\n",
    ].join("\n"),
    capture,
  );
  assert.deepEqual(malformed, {
    repo: "VrajGupta/Pi-Setup",
    capturedAt: 1_000,
    records: [],
    reason: "invalid status",
  });

  const contradictory = parseTicketSnapshot(
    [ticket("PI-06", "Done", " · Blocked-by: PI-99")].join("\n"),
    capture,
  );
  assert.equal(contradictory.reason, "contradictory blockers");

  const malformedBlockers = parseTicketSnapshot(
    [ticket("PI-07", "Coding", " · Blocked-by: none, PI-99")].join("\n"),
    capture,
  );
  assert.equal(malformedBlockers.reason, "invalid blockers");

  const duplicateBlockers = parseTicketSnapshot(
    [
      ticket("PI-08", "Coding", " · Blocked-by: PI-09, PI-09"),
      ticket("PI-09", "Done"),
    ].join("\n"),
    capture,
  );
  assert.equal(duplicateBlockers.reason, "invalid blockers");

  assert.equal(
    isValidTicketSnapshot({ repo: "", capturedAt: 1_000, records: [] }),
    false,
  );
});

test("resolves blockers without recursion and marks cycles", () => {
  const snapshot = parseTicketSnapshot(
    [
      ticket("PI-01", "Done"),
      ticket("PI-02", "Coding", " · Blocked-by: PI-01, PI-99"),
      ticket("PI-03", "Agent Ready", " · Blocked-by: PI-04"),
      ticket("PI-04", "Agent Ready", " · Blocked-by: PI-03"),
    ].join("\n"),
    capture,
  );

  assert.deepEqual(snapshot.records[1]?.blockedBy, [
    { id: "PI-01", satisfied: true },
    { id: "PI-99", satisfied: false },
  ]);
  assert.equal(snapshot.records[1]?.blocking, "blocked");
  assert.equal(snapshot.records[2]?.blocking, "blocked (cycle)");
  assert.equal(snapshot.records[3]?.blocking, "blocked (cycle)");

  const deepCycle = Array.from({ length: 12_000 }, (_, index) => {
    const id = `PI-${index + 10}`;
    const blocker = index === 11_999 ? "PI-10" : `PI-${index + 11}`;
    return ticket(id, "Coding", ` · Blocked-by: ${blocker}`);
  }).join("\n");
  const deepSnapshot = parseTicketSnapshot(deepCycle, capture);
  assert.equal(deepSnapshot.records.length, 12_000);
  assert.equal(deepSnapshot.records[0]?.blocking, "blocked (cycle)");
  assert.equal(deepSnapshot.records.at(-1)?.blocking, "blocked (cycle)");
});

test("ignores ticket-shaped headings and fields inside fenced code", () => {
  const snapshot = parseTicketSnapshot(
    [
      "```markdown",
      "## PI-99 — fake ticket",
      "",
      "Status: **Done** · Blocked-by: none",
      "```",
      ticket("PI-01", "Coding", " · Blocked-by: PI-99"),
    ].join("\n"),
    capture,
  );

  assert.deepEqual(snapshot.records, [
    {
      repo: "VrajGupta/Pi-Setup",
      id: "PI-01",
      title: "PI-01 title",
      status: "coding",
      blockedBy: [{ id: "PI-99", satisfied: false }],
      blocking: "blocked",
      assignee: "coder",
      eta: { kind: "unknown" },
    },
  ]);
});

test("does not parse metadata-shaped prose from a ticket title", () => {
  const snapshot = parseTicketSnapshot(
    "## PI-01 — title · Blocked-by: PI-99\n\nStatus: **Coding**\n",
    capture,
  );

  assert.deepEqual(snapshot.records[0]?.blockedBy, []);
  assert.equal(snapshot.records[0]?.blocking, "unblocked");
});

test("fails closed when duplicate ticket IDs make blocker ownership ambiguous", () => {
  const snapshot = parseTicketSnapshot(
    [
      ticket("PI-01", "Done"),
      ticket("PI-01", "Coding", " · Blocked-by: PI-01"),
      ticket("PI-02", "Coding", " · Blocked-by: PI-01"),
    ].join("\n"),
    capture,
  );

  assert.deepEqual(snapshot, {
    repo: "VrajGupta/Pi-Setup",
    capturedAt: 1_000,
    records: [],
    reason: "duplicate ticket id",
  });

  const duplicateWithEta = parseTicketSnapshot(
    [
      ticket("PI-10", "Done", "\nMeasured-stage-duration-ms: 100"),
      ticket("PI-10", "Done", "\nMeasured-stage-duration-ms: 200"),
      ticket("PI-11", "Done", "\nMeasured-stage-duration-ms: 300"),
    ].join("\n"),
    capture,
  );
  assert.equal(duplicateWithEta.reason, "duplicate ticket id");
});

test("uses only explicit measured completed-stage durations for ETA", () => {
  const samples = [
    ticket("PI-01", "Done", "\n\nMeasured-stage-duration-ms: 60_000"),
    ticket("PI-02", "Done", "\n\nMeasured-stage-duration-ms: 120_000"),
    ticket("PI-03", "Done", "\n\nMeasured-stage-duration-ms: 180_000"),
    ticket("PI-04", "Coding", "\n\nProgress: 99%\nTokens: 1\nElapsed: 9h"),
  ].join("\n");
  const estimated = parseTicketSnapshot(samples, capture).records[3]?.eta;
  assert.deepEqual(estimated, {
    kind: "estimated",
    minMs: 60_000,
    maxMs: 180_000,
    n: 3,
  });

  const unknown = parseTicketSnapshot(
    samples.replace("Measured-stage-duration-ms: 180_000", "Elapsed: 8h"),
    capture,
  ).records[3]?.eta;
  assert.deepEqual(unknown, { kind: "unknown" });

  const invalidSamples = [
    ticket("PI-05", "Done", "\n\nMeasured-stage-duration-ms: -1"),
    ticket("PI-06", "Done", "\n\nMeasured-stage-duration-ms: NaN"),
    ticket("PI-07", "Done", "\n\nMeasured-stage-duration-ms: 9007199254740992"),
  ].join("\n");
  assert.deepEqual(
    parseTicketSnapshot(invalidSamples, capture).records[0]?.eta,
    { kind: "unknown" },
  );
});

test("parses a 10,000-line tracker in under 100ms", () => {
  const source = Array.from(
    { length: 2_000 },
    (_, index) =>
      `## PI-${index} — ticket ${index}\n\nStatus: **Done**\n\nMeasured-stage-duration-ms: 1\n`,
  ).join("\n");
  const start = performance.now();
  const snapshot = parseTicketSnapshot(source, capture);

  assert.equal(snapshot.records.length, 2_000);
  assert.ok(performance.now() - start < 100);
});

test("a ticket missing status never inherits from a following malformed heading", () => {
  const source =
    "## PI-01 — valid ticket missing status\n\n## PI-02 -- malformed heading\n\nStatus: **Done**\n";
  const snapshot = parseTicketSnapshot(source, capture);
  assert.deepEqual(snapshot, {
    repo: "VrajGupta/Pi-Setup",
    capturedAt: 1_000,
    records: [],
    reason: "invalid status",
  });
});
