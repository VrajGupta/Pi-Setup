import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  classifyRequest,
  parseControlEnvelope,
  type WorkflowMode,
} from "./src/policy.ts";

test("routes high-risk work into planner", () => {
  const route = classifyRequest(
    "Add a payment webhook with idempotent retries",
  );
  assert.equal(route.mode, "fleet");
  assert.equal(route.stage, "planner");
  assert.equal(route.confidence, "high");
  assert.deepEqual(route.skills, ["provider-integration-tdd"]);
});

test("main-chat input remains orchestrator-only while workflow relay checks identity", () => {
  const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /pi\.on\(\s*["']input["']/);
  assert.doesNotMatch(source, /ctx\.ui\.(input|select)\(/);
  assert.doesNotMatch(source, /canSteerStage/);
  assert.match(
    source,
    /if \(input\.action === "send"\)[\s\S]*await sendToStage\(input\.id, input\.text\)/,
  );
  assert.match(
    source,
    /const sendToStage = async \(id: string, text: string\) => \{[\s\S]*state\.stageAgentId !== id[\s\S]*active workflow stage/,
  );
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

test("free mode routes risky/broad prompts direct unless a stage is named", () => {
  const risky = classifyRequest(
    "Add a payment webhook with idempotent retries",
    "free",
  );
  assert.equal(risky.mode, "direct");
  assert.equal(risky.stage, null);
  const broad = classifyRequest(
    "Build an end-to-end feature across modules",
    "free",
  );
  assert.equal(broad.mode, "direct");
  assert.equal(broad.stage, null);
  const staged = classifyRequest("Run coder against this diff", "free");
  assert.equal(staged.mode, "fleet");
  assert.equal(staged.stage, "coder");
  const legacy = classifyRequest("part3 please", "free");
  assert.equal(legacy.mode, "fleet");
  assert.equal(legacy.stage, "debugger");
});

test("workflow mode is the default and matches current routing", () => {
  const risky = classifyRequest(
    "Add a payment webhook with idempotent retries",
  );
  assert.equal(risky.mode, "fleet");
  assert.equal(risky.stage, "planner");
  const small = classifyRequest("Sort a list of names");
  assert.equal(small.mode, "direct");
  assert.equal(small.stage, null);
  for (const invalid of ["free-mode", "fleet", ""]) {
    const route = classifyRequest(
      "Add a payment webhook",
      invalid as WorkflowMode,
    );
    assert.equal(route.mode, "fleet");
    assert.equal(route.stage, "planner");
  }
});

test("mode changes routing only, never exposes prompt text (INV-8)", () => {
  const secret = "sk-live-abcdefghijklmnopqrstuvwx";
  const prompt = `migrate the production database using ${secret}`;
  for (const mode of ["workflow", "free"] as const) {
    const decision = classifyRequest(prompt, mode);
    assert.equal(decision.mode, mode === "workflow" ? "fleet" : "direct");
    assert.ok(
      !JSON.stringify(decision).includes(secret),
      `${mode} mode leaked prompt text`,
    );
  }
});
