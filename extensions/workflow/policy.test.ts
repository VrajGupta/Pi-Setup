import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { classifyRequest, parseControlEnvelope } from "./src/policy.ts";

test("routes high-risk work into planner", () => {
  const route = classifyRequest(
    "Add a payment webhook with idempotent retries",
  );
  assert.equal(route.mode, "fleet");
  assert.equal(route.stage, "planner");
  assert.equal(route.confidence, "high");
  assert.deepEqual(route.skills, ["provider-integration-tdd"]);
});

test("normal user input always stays with the orchestrator", () => {
  const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /pi\.on\(["']input["']/);
  assert.match(source, /Human messages always go to the orchestrator/);
});

test("keeps explanations on the direct path", () => {
  const route = classifyRequest("Explain how the session tree works");
  assert.equal(route.mode, "direct");
  assert.equal(route.stage, null);
});

test("respects explicit stage requests", () => {
  const route = classifyRequest("Run debugger against this diff");
  assert.equal(route.stage, "debugger");
  assert.equal(route.confidence, "high");
});

test("extracts a control envelope from wrapped stage output", () => {
  const envelope = parseControlEnvelope(
    'Subagent finished.\n\n{"kind":"blocked","stage":"coder","reason":"gate is red","recovery":"fix test"}',
  );
  assert.deepEqual(envelope, {
    kind: "blocked",
    stage: "coder",
    reason: "gate is red",
    recovery: "fix test",
  });
});

test("rejects malformed control JSON", () => {
  assert.equal(parseControlEnvelope('{"kind":"stage_complete"}'), null);
});
