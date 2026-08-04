import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import workflowExtension from "./index.ts";
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

test("changes begin exactly at the stable-prefix boundary", () => {
  const first = assembleWorkflowSystemPrompt({
    baseSystemPrompt,
    route: route({ reason: "first route reason" }),
  });
  const second = assembleWorkflowSystemPrompt({
    baseSystemPrompt,
    route: route({ reason: "second route reason" }),
  });

  assert.equal(
    first.systemPrompt.slice(0, first.stablePrefix.length),
    first.stablePrefix,
  );
  assert.equal(
    second.systemPrompt.slice(0, second.stablePrefix.length),
    second.stablePrefix,
  );
  assert.equal(
    first.systemPrompt.slice(first.stablePrefix.length),
    first.volatileSuffix,
  );
  assert.equal(
    second.systemPrompt.slice(second.stablePrefix.length),
    second.volatileSuffix,
  );
  assert.equal(
    first.systemPrompt.slice(0, first.stablePrefix.length),
    second.systemPrompt.slice(0, second.stablePrefix.length),
  );
});

test("documents opaque/rootless colon-delimited userinfo as excluded from PI-07 scope", () => {
  const source = readFileSync(
    new URL("./prompt-assembly.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /sip:user:password@example\.test/);
  assert.match(source, /accepted residual risk under unchanged global INV-2/);
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

test("redacts complete quoted credential values containing whitespace", () => {
  const assembly = assembleWorkflowSystemPrompt({
    baseSystemPrompt:
      "CORE password=\"SYNTHETIC_FIRST SECRET_TAIL\" api_key='SYNTHETIC_SECOND SECRET_TAIL'",
    route: route({
      reason: 'credential="SYNTHETIC_THIRD SECRET_TAIL"',
    }),
  });

  assert.doesNotMatch(assembly.systemPrompt, /SYNTHETIC_|SECRET_TAIL/);
});

test("redacts quoted credentials containing escaped quotes", () => {
  const assembly = assembleWorkflowSystemPrompt({
    baseSystemPrompt: 'CORE password="SYNTHETIC_ESCAPED\\"SECRET_TAIL"',
    route: route(),
  });

  assert.doesNotMatch(assembly.systemPrompt, /SYNTHETIC_|SECRET_TAIL/);
});

test("fails closed for malformed and whitespace-delimited credentials", () => {
  const assembly = assembleWorkflowSystemPrompt({
    baseSystemPrompt:
      'CORE password="SYNTHETIC_UNTERMINATED SECRET_TAIL\napi_key=SYNTHETIC_UNQUOTED SECRET_TAIL',
    route: route(),
  });

  assert.doesNotMatch(assembly.systemPrompt, /SYNTHETIC_|SECRET_TAIL/);
});

test("redacts folded sensitive headers without consuming neighboring lines", () => {
  const assembly = assembleWorkflowSystemPrompt({
    baseSystemPrompt:
      'CORE\nAuthorization: Digest username="ordinary",\r\n\tresponse="SYNTHETIC_AUTH_HEADER"\r\nordinary: keep this\nCookie: session=ordinary;\n csrf=SYNTHETIC_COOKIE_HEADER\nordinary-two: keep this too',
    route: route(),
  });

  assert.doesNotMatch(assembly.systemPrompt, /SYNTHETIC_/);
  assert.match(assembly.stablePrefix, /ordinary: keep this/);
  assert.match(assembly.stablePrefix, /ordinary-two: keep this too/);
});

test("redacts AWS credentials through the production before_agent_start seam", async () => {
  let beforeAgentStart: unknown;
  const workflowPi = {
    on(event: string, handler: unknown) {
      if (event === "before_agent_start") beforeAgentStart = handler;
    },
    events: {
      emit() {},
      on() {
        return () => {};
      },
    },
    registerCommand() {},
    registerShortcut() {},
    registerTool() {},
  } as unknown as ExtensionAPI;

  workflowExtension(workflowPi);
  assert.ok(beforeAgentStart);
  const result = await (
    beforeAgentStart as (
      event: { prompt: string; systemPrompt: string },
      ctx: { mode: "tui" },
    ) => Promise<{ systemPrompt?: string } | undefined>
  )(
    {
      prompt: "Explain the session tree",
      systemPrompt: "CORE AWS_ACCESS_KEY_ID=SYNTHETIC_ACCESS_VALUE",
    },
    { mode: "tui" },
  );

  assert.ok(result?.systemPrompt);
  assert.doesNotMatch(result.systemPrompt, /SYNTHETIC_/);
});

test("redacts credential-bearing non-HTTP URLs through the production seam", async () => {
  let beforeAgentStart: unknown;
  const workflowPi = {
    on(event: string, handler: unknown) {
      if (event === "before_agent_start") beforeAgentStart = handler;
    },
    events: {
      emit() {},
      on() {
        return () => {};
      },
    },
    registerCommand() {},
    registerShortcut() {},
    registerTool() {},
  } as unknown as ExtensionAPI;

  workflowExtension(workflowPi);
  assert.ok(beforeAgentStart);
  const result = await (
    beforeAgentStart as (
      event: { prompt: string; systemPrompt: string },
      ctx: { mode: "tui" },
    ) => Promise<{ systemPrompt?: string } | undefined>
  )(
    {
      prompt: "Explain the session tree",
      systemPrompt: `CORE
ordinary-before=keep
DATABASE_URL=postgres://synthetic-user:SYNTHETIC_DATABASE_PASSWORD@db.example/test
REDIS_URL=rediss://cache-user:SYNTHETIC_REDIS_PASSWORD@cache.example:6380/0
MONGO_URI=mongodb+srv://mongo-user:SYNTHETIC_MONGO_PASSWORD@cluster.example/app
BROKEN_DATABASE_URL=postgres:/synthetic-user:SYNTHETIC_MALFORMED_DATABASE_PASSWORD@db.example/test
QUOTED_DATABASE_URL='postgres://synthetic-user:SYNTHETIC_QUOTED_DATABASE_PASSWORD@db.example/test'
connect postgres:/synthetic-user:SYNTHETIC_UNLABELED_MALFORMED_PASSWORD@db.example/test
connect jdbc:oracle:thin:synthetic-user/SYNTHETIC_OPAQUE_PASSWORD@db.example:1521:app
ordinary-after=keep`,
    },
    { mode: "tui" },
  );

  assert.ok(result?.systemPrompt);
  assert.doesNotMatch(result.systemPrompt, /SYNTHETIC_/);
  assert.match(result.systemPrompt, /ordinary-before=keep/);
  assert.match(result.systemPrompt, /ordinary-after=keep/);
});

test("uses the tested assembly seam on the production before_agent_start path", () => {
  const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.match(source, /from "\.\/prompt-assembly\.ts"/);
  assert.match(
    source,
    /systemPrompt:\s*assembleWorkflowSystemPrompt\(\{[\s\S]*baseSystemPrompt:\s*event\.systemPrompt[\s\S]*route:\s*decision[\s\S]*\}\)\.systemPrompt/,
  );
});
