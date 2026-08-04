import assert from "node:assert/strict";
import { test } from "node:test";
import {
  STAGE_NAMES,
  isWorkflowBridgeRequest,
  isWorkflowSubagentSummary,
} from "./workflow-state.ts";

const base = {
  id: "sa-1",
  title: "part2 · build the thing",
  status: "running",
  backend: "pi",
  turns: 3,
  startedAt: 1_754_000_000_000,
};

test("accepts a summary with stage and startedAt", () => {
  assert.equal(isWorkflowSubagentSummary({ ...base, stage: "part2" }), true);
});

test("accepts a summary with no stage (non-stage helper agent)", () => {
  assert.equal(isWorkflowSubagentSummary(base), true);
});

test("rejects a summary whose startedAt is missing or not a number", () => {
  const { startedAt: _omitted, ...missing } = base;
  assert.equal(isWorkflowSubagentSummary(missing), false);
  assert.equal(
    isWorkflowSubagentSummary({ ...base, startedAt: "just now" }),
    false,
  );
  assert.equal(isWorkflowSubagentSummary({ ...base, startedAt: null }), false);
});

test("rejects non-finite summary timestamps", () => {
  assert.equal(
    isWorkflowSubagentSummary({ ...base, startedAt: Number.NaN }),
    false,
  );
  assert.equal(
    isWorkflowSubagentSummary({ ...base, startedAt: Number.POSITIVE_INFINITY }),
    false,
  );
  assert.equal(
    isWorkflowSubagentSummary({ ...base, startedAt: Number.NEGATIVE_INFINITY }),
    false,
  );
});

test("rejects a stage outside part1|part2|part3|part4", () => {
  assert.equal(isWorkflowSubagentSummary({ ...base, stage: "part5" }), false);
  assert.equal(isWorkflowSubagentSummary({ ...base, stage: "helper" }), false);
  assert.equal(isWorkflowSubagentSummary({ ...base, stage: 2 }), false);
  for (const stage of STAGE_NAMES) {
    assert.equal(isWorkflowSubagentSummary({ ...base, stage }), true);
  }
});

const spawnBase = {
  kind: "spawn",
  prompt: "do the thing",
  title: "part3 · attack it",
  cwd: "/tmp",
  harness: "pi",
  resolve: () => undefined,
};

test("spawn bridge requests may carry a valid stage", () => {
  assert.equal(isWorkflowBridgeRequest({ ...spawnBase, stage: "part3" }), true);
  assert.equal(isWorkflowBridgeRequest(spawnBase), true);
});

test("spawn bridge requests reject an invalid stage", () => {
  assert.equal(
    isWorkflowBridgeRequest({ ...spawnBase, stage: "part9" }),
    false,
  );
});
