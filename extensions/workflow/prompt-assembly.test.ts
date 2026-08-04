import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assembleWorkflowSystemPrompt } from "./prompt-assembly.ts";
import { classifyRequest, type RouteDecision } from "./src/policy.ts";

const baseSystemPrompt = "CORE SYSTEM\nKeep this instruction byte-stable.";

function route(overrides: Partial<RouteDecision> = {}): RouteDecision {
  return {
    mode: "direct",
    stage: null,
    confidence: "high",
    reason: "small reversible task",
    skills: [],
    ...overrides,
  };
}

test("keeps the full stable prefix byte-identical across route and task changes", () => {
  const direct = assembleWorkflowSystemPrompt({
    baseSystemPrompt,
    route: classifyRequest("Explain the session tree"),
  });
  const fleet = assembleWorkflowSystemPrompt({
    baseSystemPrompt,
    route: classifyRequest("Implement a billing webhook"),
  });

  assert.equal(direct.stablePrefix, fleet.stablePrefix);
  assert.notEqual(direct.volatileSuffix, fleet.volatileSuffix);
  assert.equal(
    direct.systemPrompt,
    `${direct.stablePrefix}${direct.volatileSuffix}`,
  );
  assert.equal(
    fleet.systemPrompt,
    `${fleet.stablePrefix}${fleet.volatileSuffix}`,
  );
  assert.ok(direct.systemPrompt.startsWith(direct.stablePrefix));
  assert.ok(fleet.systemPrompt.startsWith(fleet.stablePrefix));
});

test("changes only the suffix when the active stage changes", () => {
  const planner = assembleWorkflowSystemPrompt({
    baseSystemPrompt,
    route: route({ mode: "fleet", stage: "planner" }),
  });
  const reviewer = assembleWorkflowSystemPrompt({
    baseSystemPrompt,
    route: route({ mode: "fleet", stage: "reviewer" }),
  });

  assert.equal(planner.stablePrefix, reviewer.stablePrefix);
  assert.notEqual(planner.volatileSuffix, reviewer.volatileSuffix);
  assert.match(planner.volatileSuffix, /fleet via planner/);
  assert.match(reviewer.volatileSuffix, /fleet via reviewer/);
});

test("redacts synthetic credentials and provider URLs from both prompt regions", () => {
  const assembly = assembleWorkflowSystemPrompt({
    baseSystemPrompt:
      "CORE Authorization: Bearer SYNTHETIC_BASE_TOKEN\nProvider: https://provider.synthetic.example/v1",
    route: route({
      reason:
        "use api_key=SYNTHETIC_ROUTE_KEY at https://route.synthetic.example",
      skills: ["token=SYNTHETIC_SKILL_TOKEN"],
    }),
  });

  assert.match(assembly.stablePrefix, /Authorization: \[REDACTED\]/);
  assert.match(assembly.stablePrefix, /\[URL\]/);
  assert.match(assembly.volatileSuffix, /api_key=\[REDACTED\]/);
  assert.match(assembly.volatileSuffix, /token=\[REDACTED\]/);
  assert.doesNotMatch(assembly.systemPrompt, /SYNTHETIC_|https:\/\//);
});

test("redacts synthetic token formats and URL query credentials", () => {
  const assembly = assembleWorkflowSystemPrompt({
    baseSystemPrompt:
      "CORE sk-SYNTHETIC_SECRET_VALUE ghp_SYNTHETIC_ACCESS_VALUE",
    route: route({
      reason:
        "call https://provider.synthetic.example/v1?access_token=SYNTHETIC_QUERY_TOKEN",
    }),
  });

  assert.doesNotMatch(assembly.systemPrompt, /SYNTHETIC_|https:\/\//);
});

test("uses the tested assembly seam on the production before_agent_start path", () => {
  const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.match(source, /from "\.\/prompt-assembly\.ts"/);
  assert.match(
    source,
    /systemPrompt:\s*assembleWorkflowSystemPrompt\(\{[\s\S]*baseSystemPrompt:\s*event\.systemPrompt[\s\S]*route:\s*decision[\s\S]*\}\)\.systemPrompt/,
  );
});
