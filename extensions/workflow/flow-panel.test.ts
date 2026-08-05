import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import type {
  WorkflowState,
  WorkflowSubagentSummary,
} from "../shared/workflow-state.ts";
import { FlowPanel, type FlowPanelContext } from "./index.ts";

const theme = {
  bg: (_color: string, text: string) => text,
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

const context = {
  cwd: "/repo",
  model: undefined,
  thinkingLevel: "high",
  getContextUsage: () => undefined,
  sessionManager: { getSessionFile: () => undefined },
} satisfies FlowPanelContext;

function state(overrides: Partial<WorkflowState> = {}): WorkflowState {
  return {
    status: "idle",
    activeStage: null,
    route: {
      mode: "direct",
      stage: null,
      confidence: "high",
      reason: "the request is small and reversible",
      skills: [],
    },
    taskPreview: "",
    stageAgentId: null,
    agentIds: [],
    lastEvent: "",
    updatedAt: 1_000,
    ...overrides,
  };
}

function agent(overrides: Partial<WorkflowSubagentSummary> = {}) {
  return {
    id: "a1",
    title: "agent",
    status: "running" as const,
    backend: "pi" as const,
    startedAt: Date.now(),
    turns: 3,
    ...overrides,
  };
}

function panel(
  workflowState = state(),
  agents: WorkflowSubagentSummary[] = [],
  overrides: Partial<FlowPanelContext> = {},
) {
  return new FlowPanel(
    { ...context, ...overrides },
    theme,
    () => workflowState,
    () => agents,
    () => [],
    () => ({ loaded: [], selected: [] }),
    () => {},
    () => {},
  );
}

function agentsTab(flow: FlowPanel) {
  flow.handleInput("\t");
  flow.handleInput("\t");
}

test("Agents lists stages in pipeline order before helpers", () => {
  const flow = panel(state(), [
    agent({ id: "helper", title: "helper" }),
    agent({ id: "p4", stage: "reviewer" }),
    agent({ id: "p2", stage: "coder" }),
    agent({ id: "p1", stage: "planner" }),
  ]);
  agentsTab(flow);

  const output = flow.render(120).join("\n");
  assert.ok(output.indexOf("planner") < output.indexOf("coder"));
  assert.ok(output.indexOf("coder") < output.indexOf("reviewer"));
  assert.ok(output.indexOf("reviewer") < output.indexOf("helper"));
});

test("Agents renders the literal none tracked line", () => {
  const flow = panel();
  agentsTab(flow);

  assert.match(flow.render(120).join("\n"), / none tracked/);
});

test("Overview explains the route and only shows waiting on for waiting states", () => {
  const waiting = ["needs-input", "needs-helper", "blocked"] as const;
  for (const status of waiting) {
    const output = panel(state({ status, lastEvent: "a plain next step" }))
      .render(120)
      .join("\n");
    assert.match(
      output,
      /why this route.*The direct route was chosen because the request is small and reversible\./,
    );
    assert.match(output, /waiting on.*a plain next step/);
  }

  for (const status of [
    "idle",
    "routing",
    "running",
    "complete",
    "recoverable",
  ] as const) {
    const output = panel(state({ status, lastEvent: "not a blocker" }))
      .render(120)
      .join("\n");
    assert.match(
      output,
      /why this route.*The direct route was chosen because the request is small and reversible\./,
    );
    assert.doesNotMatch(output, /waiting on/);
  }
});

test("the overview renders the live routing mode as text (PI-19)", () => {
  for (const [mode, expected] of [
    ["workflow", /mode\s+workflow/],
    ["free", /mode\s+free/],
  ] as const) {
    const output = panel(state({ mode })).render(120).join("\n");
    assert.match(output, expected);
    // INV-11: the mode is spelled as text, not carried by colour alone.
    assert.match(output, /mode\s+workflow|mode\s+free/);
  }
  // Absent mode defaults to the configured default (workflow).
  const defaulted = panel(state({ mode: undefined }))
    .render(120)
    .join("\n");
  assert.match(defaulted, /mode\s+workflow/);
});

test("panel rows fit widths 40 and 120", () => {
  const flow = panel(
    state({
      status: "blocked",
      lastEvent: "a very long reason that must remain bounded in the panel",
      route: {
        mode: "fleet",
        stage: "coder",
        confidence: "high",
        reason:
          "the request spans several modules and needs independent review",
        skills: [],
      },
    }),
    [
      agent({
        stage: "planner",
        modelLabel: "openai-codex/gpt-5.6-terra-with-an-extra-long-label",
        title: "a very long agent title that must remain bounded",
      }),
    ],
  );
  for (const width of [40, 120]) {
    for (const line of flow.render(width)) {
      assert.ok(
        visibleWidth(line) <= width,
        `width ${width}: ${JSON.stringify(line)} is ${visibleWidth(line)}`,
      );
    }
  }
});

test("stage readings label measured context and omit percent when indeterminate", () => {
  const measured = panel(state(), [
    agent({ stage: "coder", contextTokens: 1, contextWindow: 2 }),
  ]);
  agentsTab(measured);
  assert.match(measured.render(120).join("\n"), /50% ctx/);

  const tiny = panel(state(), [
    agent({ stage: "coder", contextTokens: 1, contextWindow: 1_000 }),
  ]);
  agentsTab(tiny);
  assert.match(tiny.render(120).join("\n"), /<1% ctx/);
  assert.doesNotMatch(tiny.render(120).join("\n"), /0%/);

  const indeterminate = panel(state(), [agent({ stage: "coder" })]);
  agentsTab(indeterminate);
  assert.doesNotMatch(indeterminate.render(120).join("\n"), /%/);
});

test("stage rows use only closed, redacted reasons for silence", () => {
  const stale = panel(
    state({ status: "running", activeStage: "coder" }),
    [agent({ stage: "coder" })],
    { getAgentsUpdatedAt: () => Date.now() - 30_001 },
  );
  agentsTab(stale);
  assert.match(stale.render(200).join("\n"), /~ stale bridge/);

  for (const [status, reason] of [
    ["needs-input", "waiting on question"],
    ["needs-helper", "waiting on helper"],
  ] as const) {
    const waiting = panel(state({ status, activeStage: "coder" }), [
      agent({ stage: "coder" }),
    ]);
    agentsTab(waiting);
    assert.match(waiting.render(200).join("\n"), new RegExp(reason));
  }

  const providerError = panel(
    state({
      status: "blocked",
      activeStage: "coder",
      lastEvent: "Authorization: Bearer synthetic-secret-token",
    }),
    [agent({ stage: "coder", status: "error" })],
  );
  agentsTab(providerError);
  const errorOutput = providerError.render(200).join("\n");
  assert.match(errorOutput, /provider error.*\[REDACTED\]/);
  assert.doesNotMatch(errorOutput, /synthetic-secret-token/);

  const unknown = panel(state(), [agent({ stage: "coder" })]);
  agentsTab(unknown);
  assert.match(unknown.render(200).join("\n"), /reason unknown/);
});

test("generic blocked errors render reason unknown, never a fabricated provider cause", () => {
  for (const lastEvent of [
    "local validation error",
    "previous run found; verify evidence before resuming",
    "malformed input rejected",
  ]) {
    const blocked = panel(
      state({ status: "blocked", activeStage: "coder", lastEvent }),
      [agent({ stage: "coder" })],
    );
    agentsTab(blocked);
    const output = blocked.render(200).join("\n");
    assert.match(output, /reason unknown/);
    assert.doesNotMatch(output, /provider error/);
  }
  // A genuinely provider-shaped event still renders provider error.
  const provider = panel(
    state({
      status: "blocked",
      activeStage: "coder",
      lastEvent: "provider timeout after 30s",
    }),
    [agent({ stage: "coder" })],
  );
  agentsTab(provider);
  assert.match(provider.render(200).join("\n"), /provider error/);
});

test("an indeterminate row with provider detail never renders a percent", () => {
  const indeterminate = panel(
    state({
      status: "blocked",
      activeStage: "coder",
      lastEvent: "provider error: 50% failure rate",
    }),
    [agent({ stage: "coder", status: "error" })],
  );
  agentsTab(indeterminate);
  const output = indeterminate.render(200).join("\n");
  assert.doesNotMatch(output, /%/);
});

test("quota-limit reason mapping is pinned (closed vocabulary)", () => {
  for (const lastEvent of [
    "quota exceeded",
    "rate limit reached",
    "spend limit hit",
  ]) {
    const quota = panel(
      state({ status: "blocked", activeStage: "coder", lastEvent }),
      [agent({ stage: "coder" })],
    );
    agentsTab(quota);
    assert.match(quota.render(200).join("\n"), /quota limit/);
  }
});

test("FlowPanel rendering contains no filesystem, network, or subprocess call", () => {
  const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  const panelSource = source.slice(
    source.indexOf("class FlowPanel"),
    source.indexOf("function formatTokens"),
  );
  assert.doesNotMatch(panelSource, /node:(fs|child_process|http|https|net)/);
  assert.doesNotMatch(panelSource, /\b(fetch|exec|spawn|WebSocket)\s*\(/);
});

test("unknown stages behave as helpers while duplicate known stages stay stable", () => {
  const flow = panel(state(), [
    agent({ id: "helper", title: "helper" }),
    agent({
      id: "unknown",
      title: "unknown-stage",
      stage: "part9" as unknown as WorkflowSubagentSummary["stage"],
      contextTokens: 1,
      contextWindow: 2,
    }),
    agent({ id: "coder-b", stage: "coder" }),
    agent({ id: "coder-a", stage: "coder" }),
    agent({ id: "planner", stage: "planner" }),
  ]);
  agentsTab(flow);

  const output = flow.render(120).join("\n");
  assert.ok(
    output.indexOf("planner · planner") < output.indexOf("coder · coder-b"),
  );
  assert.ok(
    output.indexOf("coder · coder-b") < output.indexOf("coder · coder-a"),
  );
  assert.ok(
    output.indexOf("coder · coder-a") < output.indexOf("helper · helper"),
  );
  assert.ok(
    output.indexOf("helper · helper · helper") <
      output.indexOf("helper · unknown · unknown-stage"),
  );
  assert.doesNotMatch(output, /part9/);
  assert.doesNotMatch(output, /unknown-stage.*50%/);
});

test("route reasons and waiting events are one-line, terminal-safe, and redacted", () => {
  const flow = panel(
    state({
      status: "blocked",
      lastEvent: "event\n\u001b[2Japi_key=event-secret-value",
      route: {
        mode: "direct",
        stage: null,
        confidence: "high",
        reason:
          "reason\n\u001b]52;c;clipboard\u0007 with api_key=route-secret-value, https://agentrouter.org/v1, and unicode 日本語😀",
        skills: [],
      },
    }),
  );

  const lines = flow.render(120);
  assert.ok(lines.every((line) => !line.includes("\n")));
  assert.ok(lines.every((line) => !line.includes("\u001b")));
  const output = lines.join("\n");
  assert.doesNotMatch(
    output,
    /route-secret-value|event-secret-value|agentrouter\.org/,
  );
  assert.match(output, /waiting on/);
});

test("composite authorization and cookie headers redact every parameter", () => {
  const cases = [
    {
      value:
        'Authorization: Digest username="vraj", response="auth-secret"; Cookie: session=event-secret; csrf=event-csrf',
      secrets: ["auth-secret", "event-secret", "event-csrf"],
    },
    {
      value: `Cookie: session="quoted-cookie-secret"; csrf='quoted-csrf-secret'`,
      secrets: ["quoted-cookie-secret", "quoted-csrf-secret"],
    },
  ] as const;

  for (const { value, secrets } of cases) {
    const output = panel(state({ status: "blocked", lastEvent: value }))
      .render(240)
      .join("\n");
    for (const secret of secrets)
      assert.doesNotMatch(output, new RegExp(secret));
  }
});

test("malformed auth headers fail closed without losing neighbors", () => {
  const cases = [
    {
      value:
        'ordinary before\nAuthorization: Digest username="unterminated malformed-auth-secret Cookie: session=malformed-cookie-secret\nX-Request-ID: ordinary-header\nordinary after',
      secrets: ["malformed-auth-secret", "malformed-cookie-secret"],
    },
    {
      value:
        'ordinary before\nCookie: session="unterminated malformed-cookie-secret Authorization: Digest response=malformed-auth-secret\nX-Request-ID: ordinary-header\nordinary after',
      secrets: ["malformed-cookie-secret", "malformed-auth-secret"],
    },
  ] as const;

  for (const { value, secrets } of cases) {
    const output = panel(state({ status: "blocked", lastEvent: value }))
      .render(240)
      .join("\n");
    assert.match(output, /ordinary before/);
    assert.match(output, /Authorization: \[REDACTED\]/);
    assert.match(output, /Cookie: \[REDACTED\]/);
    assert.match(output, /ordinary after/);
    for (const secret of secrets)
      assert.doesNotMatch(output, new RegExp(secret));
  }
});

test("folded auth headers redact continuations without losing neighbors", () => {
  const cases = [
    {
      header: "Authorization",
      value:
        'ordinary before\nAuthorization: Digest username="ordinary",\n response="SYNTHETIC_FOLDED_AUTH_VALUE"\nX-Request-ID: ordinary-header\nordinary after',
      secret: "SYNTHETIC_FOLDED_AUTH_VALUE",
    },
    {
      header: "Cookie",
      value:
        "ordinary before\nCookie: session=ordinary;\n csrf=SYNTHETIC_FOLDED_COOKIE_VALUE\nX-Request-ID: ordinary-header\nordinary after",
      secret: "SYNTHETIC_FOLDED_COOKIE_VALUE",
    },
  ] as const;

  for (const { header, value, secret } of cases) {
    const output = panel(state({ status: "blocked", lastEvent: value }))
      .render(240)
      .join("\n");
    assert.match(output, /ordinary before/);
    assert.match(output, new RegExp(`${header}: \\[REDACTED\\]`));
    assert.match(output, /X-Request-ID: ordinary-header/);
    assert.match(output, /ordinary after/);
    assert.doesNotMatch(output, new RegExp(secret));
  }
});

test("waiting statuses use explicit fallbacks and disappear after transition", () => {
  let current = state({ status: "running", lastEvent: "not waiting" });
  const flow = new FlowPanel(
    context,
    theme,
    () => current,
    () => [],
    () => [],
    () => ({ loaded: [], selected: [] }),
    () => {},
    () => {},
  );

  assert.doesNotMatch(flow.render(120).join("\n"), /waiting on/);
  for (const [status, fallback] of [
    ["needs-input", "your input"],
    ["needs-helper", "a helper result"],
    ["blocked", "a recovery path"],
  ] as const) {
    current = state({ status, lastEvent: "" });
    assert.match(
      flow.render(120).join("\n"),
      new RegExp(`waiting on  ${fallback}`),
    );
  }
  current = state({ status: "complete", lastEvent: "finished" });
  assert.doesNotMatch(flow.render(120).join("\n"), /waiting on/);
});

test("malformed and stale readings degrade without fabricated values", () => {
  const flow = panel(
    state(),
    [
      agent({
        id: "bad",
        stage: "coder",
        startedAt: Number.NaN,
        turns: Number.POSITIVE_INFINITY,
        contextTokens: Number.POSITIVE_INFINITY,
        contextWindow: 100,
      }),
    ],
    {
      getAgentsUpdatedAt: () => Date.now() - 60_000,
      getContextUsage: () => ({
        tokens: null,
        contextWindow: 100,
        percent: Number.POSITIVE_INFINITY,
      }),
    },
  );
  agentsTab(flow);

  const output = flow.render(120).join("\n");
  assert.match(output, /~/);
  assert.doesNotMatch(output, /NaN|Infinity/);
  assert.doesNotMatch(output, /%/);
  assert.match(
    panel(state(), [], {
      getContextUsage: () => {
        throw new Error("down");
      },
    })
      .render(120)
      .join("\n"),
    /context \?\/?/,
  );
});

test("render survives failed data getters and keeps the no-agent fallback", () => {
  const flow = new FlowPanel(
    context,
    theme,
    () => state(),
    () => {
      throw new Error("agent state unavailable");
    },
    () => [],
    () => ({ loaded: [], selected: [] }),
    () => {},
    () => {},
  );

  assert.doesNotThrow(() => flow.render(120));
  flow.handleInput("\t");
  flow.handleInput("\t");
  assert.match(flow.render(120).join("\n"), / none tracked/);
});

test("tab, arrow, unknown, and escape input have bounded effects", () => {
  let rerenders = 0;
  let closed = 0;
  const flow = new FlowPanel(
    context,
    theme,
    () => state(),
    () => [],
    () => [],
    () => ({ loaded: [], selected: [] }),
    () => {
      closed += 1;
    },
    () => {
      rerenders += 1;
    },
  );

  flow.handleInput("not a key");
  assert.equal(rerenders, 0);
  flow.handleInput("\t");
  flow.handleInput("\u001b[C");
  flow.handleInput("\u001b[D");
  assert.equal(rerenders, 3);
  flow.handleInput("\u001b");
  assert.equal(closed, 1);
});

test("the frame never overflows narrow, zero, negative, or non-finite widths", () => {
  const flow = panel(state({ lastEvent: "日本語😀" }), [
    agent({ stage: "planner", title: "模型😀" }),
  ]);
  for (const width of [
    0,
    1,
    2,
    3,
    4,
    5,
    7,
    8,
    19,
    40,
    120,
    -1,
    NaN,
    Infinity,
  ]) {
    assert.doesNotThrow(() => flow.render(width));
    const bound = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
    for (const line of flow.render(width)) {
      assert.ok(
        visibleWidth(line) <= bound,
        `width ${width}: ${JSON.stringify(line)} is ${visibleWidth(line)}`,
      );
    }
  }
});

test("ANSI-themed panel rows stay within visible width at 40 and 120", () => {
  const ansiTheme = {
    bg: (_color: string, text: string) => `\u001b[48;5;1m${text}\u001b[0m`,
    fg: (_color: string, text: string) => `\u001b[38;5;2m${text}\u001b[0m`,
    bold: (text: string) => `\u001b[1m${text}\u001b[0m`,
  };
  const flow = new FlowPanel(
    {
      ...context,
      getContextUsage: () => ({ tokens: 1, contextWindow: 2, percent: 50 }),
    },
    ansiTheme,
    () =>
      state({
        status: "blocked",
        lastEvent: "a long waiting event 日本語😀".repeat(10),
        route: {
          mode: "fleet",
          stage: "coder",
          confidence: "high",
          reason: "a long route reason 日本語😀".repeat(10),
          skills: [],
        },
      }),
    () => [
      agent({
        stage: "coder",
        title: "a long agent title 日本語😀".repeat(10),
        modelLabel: "a-long-model-label/with-ansi-safe-width",
        contextTokens: 1,
        contextWindow: 2,
      }),
    ],
    () => [],
    () => ({ loaded: [], selected: [] }),
    () => {},
    () => {},
  );
  flow.handleInput("\t");
  flow.handleInput("\t");
  for (const width of [40, 120]) {
    for (const line of flow.render(width)) {
      assert.ok(visibleWidth(line) <= width);
    }
  }
});

test("1 000 panel renders at width 120 stay within a practical budget", () => {
  const flow = panel(state(), [
    agent({ stage: "planner" }),
    agent({ stage: "coder" }),
    agent({ stage: "debugger" }),
    agent({ stage: "reviewer" }),
    agent({ title: "helper" }),
  ]);
  agentsTab(flow);
  const start = performance.now();
  for (let index = 0; index < 1_000; index += 1) flow.render(120);
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 3_000, `1000 panel renders took ${elapsed}ms`);
});
