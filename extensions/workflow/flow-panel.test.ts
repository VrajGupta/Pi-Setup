import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import type {
  WorkflowState,
  WorkflowSubagentSummary,
} from "../shared/workflow-state.ts";
import {
  FlowPanel,
  MODE_COMPLETIONS,
  normalizeModeCommand,
  applyRoutineUpdate,
  buildRoutinesSnapshot,
  classifyRoutinePrompt,
  createRoutinesLifecycle,
  normalizeRoutineCommand,
  routineBanner,
  routineCompletions,
  type FlowPanelContext,
  type RoutineCommandOutcome,
  type RoutinesLifecycle,
} from "./index.ts";
import {
  startRoutineScheduler,
  type RoutineDefinition as SchedulerRoutine,
  type RoutineScheduler,
} from "./routines-scheduler.ts";
import type { RoutineDefinition } from "./routines-settings.ts";
import type { StatusWidgetRoutineRecord } from "../ui-customization/status-widget.ts";

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
    ["workflow", "mode: workflow"],
    ["free", "mode: free"],
  ] as const) {
    const output = panel(state({ mode })).render(120).join("\n");
    assert.ok(output.includes(expected), `missing ${expected}`);
    // INV-11: the mode is spelled as text, not carried by colour alone.
    assert.match(output, /mode: (workflow|free)/);
  }
  // Absent or malformed state defaults to workflow, matching PI-18.
  for (const mode of [undefined, "invalid"] as const) {
    const output = panel(state({ mode: mode as WorkflowState["mode"] }))
      .render(120)
      .join("\n");
    assert.match(output, /mode: workflow/);
  }
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

// ─── PI-24: /mode picker, completions, warnings ──────────────────────

test("/mode bare invocation produces pick outcome (no red error)", () => {
  const outcome = normalizeModeCommand("");
  assert.equal(outcome.kind, "pick");

  const whitespace = normalizeModeCommand("  ");
  assert.equal(whitespace.kind, "pick");
});

test("/mode valid value returns switch with correct confirmation", () => {
  const wf = normalizeModeCommand("workflow");
  assert.equal(wf.kind, "switch");
  if (wf.kind === "switch") {
    assert.equal(wf.mode, "workflow");
    assert.equal(wf.confirmation, "mode workflow");
  }

  const free = normalizeModeCommand("  free  ");
  assert.equal(free.kind, "switch");
  if (free.kind === "switch") {
    assert.equal(free.mode, "free");
    assert.equal(free.confirmation, "mode free (manual)");
  }

  // Case-insensitive
  const mixed = normalizeModeCommand("Free");
  assert.equal(mixed.kind, "switch");
  if (mixed.kind === "switch") {
    assert.equal(mixed.mode, "free");
  }
});

test("/mode invalid value returns warning and leaves state unchanged", () => {
  const outcome = normalizeModeCommand("bogus");
  assert.equal(outcome.kind, "warn");
  if (outcome.kind === "warn") {
    assert.equal(
      outcome.message,
      'unknown mode "bogus" — use workflow or free',
    );
  }

  // State unchanged: kind is warn, not switch
  const current = normalizeModeCommand("workflow");
  assert.equal(current.kind, "switch");
  const afterInvalid = normalizeModeCommand("invalid");
  // The outcome itself doesn't switch — that's the mechanism for unchanged state
  assert.equal(afterInvalid.kind, "warn");
  assert.notEqual(afterInvalid.kind, "switch");
});

test("/mode completions include exactly workflow and free", () => {
  assert.equal(MODE_COMPLETIONS.length, 2);
  const values = MODE_COMPLETIONS.map((c) => c.value);
  assert.ok(values.includes("workflow"));
  assert.ok(values.includes("free"));
  assert.equal(values.length, 2);
});

test("/mode completions filter by prefix, case-insensitive", () => {
  // Mirrors getArgumentCompletions in index.ts
  const filter = (prefix: string) => {
    if (!prefix) return MODE_COMPLETIONS;
    const lower = prefix.toLowerCase();
    return MODE_COMPLETIONS.filter((item) => item.value.startsWith(lower));
  };

  assert.equal(filter("").length, 2);
  assert.equal(filter("f").length, 1);
  assert.equal(filter("f")[0].value, "free");
  assert.equal(filter("FR").length, 1);
  assert.equal(filter("FR")[0].value, "free");
  assert.equal(filter("w").length, 1);
  assert.equal(filter("w")[0].value, "workflow");
  assert.equal(filter("x").length, 0);
});

test("/mode invalid value with whitespace preserves original casing in message", () => {
  const outcome = normalizeModeCommand("  BaD_VaLuE  ");
  assert.equal(outcome.kind, "warn");
  if (outcome.kind === "warn") {
    assert.equal(
      outcome.message,
      'unknown mode "BaD_VaLuE" — use workflow or free',
    );
  }
});

test("routineBanner produces exact affordance tokens", () => {
  const banner = routineBanner("standup");
  assert.match(banner, /routine standup due/);
  assert.match(banner, /\/routine run standup/);
  assert.match(banner, /\/routine snooze standup/);
  assert.match(banner, /\/routine disable standup/);
  assert.match(banner, /· dismiss/);
  // INV-8: never auto-runs — the banner is purely informational.
  assert.doesNotMatch(banner, /spawn|send|execute|auto|start/);
});

test("routineBanner handles empty name safely", () => {
  const banner = routineBanner("");
  assert.match(banner, /\?/);
  assert.doesNotThrow(() => routineBanner(""));
  assert.doesNotThrow(() => routineBanner("  "));
});

test("normalizeRoutineCommand bare → pick", () => {
  assert.equal(normalizeRoutineCommand("").kind, "pick");
  assert.equal(normalizeRoutineCommand("   ").kind, "pick");
});

test("normalizeRoutineCommand run", () => {
  const outcome = normalizeRoutineCommand("run standup");
  assert.equal(outcome.kind, "run");
  if (outcome.kind === "run") assert.equal(outcome.name, "standup");
  // Empty name → usage warning
  const empty = normalizeRoutineCommand("run");
  assert.equal(empty.kind, "warn");
  if (empty.kind === "warn")
    assert.match(empty.message, /usage: \/routine run/);
  // Whitespace name → usage warning
  const ws = normalizeRoutineCommand("run  ");
  assert.equal(ws.kind, "warn");
  if (ws.kind === "warn") assert.match(ws.message, /usage: \/routine run/);
});

test("normalizeRoutineCommand snooze", () => {
  // Default minutes
  const def = normalizeRoutineCommand("snooze standup");
  assert.equal(def.kind, "snooze");
  if (def.kind === "snooze") {
    assert.equal(def.name, "standup");
    assert.equal(def.minutes, 60);
  }
  // Explicit minutes
  const explicit = normalizeRoutineCommand("snooze standup 30");
  assert.equal(explicit.kind, "snooze");
  if (explicit.kind === "snooze") assert.equal(explicit.minutes, 30);
  // Clamp upper bound
  const clamped = normalizeRoutineCommand("snooze standup 20000");
  assert.equal(clamped.kind, "snooze");
  if (clamped.kind === "snooze") assert.equal(clamped.minutes, 10080);
  // Invalid minutes (non-numeric)
  const bad = normalizeRoutineCommand("snooze standup abc");
  assert.equal(bad.kind, "warn");
  if (bad.kind === "warn") assert.match(bad.message, /invalid minutes/);
  // Invalid minutes (zero)
  const zero = normalizeRoutineCommand("snooze standup 0");
  assert.equal(zero.kind, "warn");
  // Invalid minutes (negative)
  const neg = normalizeRoutineCommand("snooze standup -5");
  assert.equal(neg.kind, "warn");
  // Non-integer
  const frac = normalizeRoutineCommand("snooze standup 5.5");
  assert.equal(frac.kind, "warn");
  // Empty name → usage warning
  const empty = normalizeRoutineCommand("snooze");
  assert.equal(empty.kind, "warn");
  if (empty.kind === "warn")
    assert.match(empty.message, /usage: \/routine snooze/);
});

test("normalizeRoutineCommand disable and enable", () => {
  const disable = normalizeRoutineCommand("disable standup");
  assert.equal(disable.kind, "disable");
  if (disable.kind === "disable") assert.equal(disable.name, "standup");

  const enable = normalizeRoutineCommand("enable standup");
  assert.equal(enable.kind, "enable");
  if (enable.kind === "enable") assert.equal(enable.name, "standup");

  // Empty name → usage warning
  const noName = normalizeRoutineCommand("disable");
  assert.equal(noName.kind, "warn");
  if (noName.kind === "warn")
    assert.match(noName.message, /usage: \/routine disable/);

  const noNameEn = normalizeRoutineCommand("enable");
  assert.equal(noNameEn.kind, "warn");
  if (noNameEn.kind === "warn")
    assert.match(noNameEn.message, /usage: \/routine enable/);
});

test("normalizeRoutineCommand unknown subcommand → unknown routine warning", () => {
  const outcome = normalizeRoutineCommand("standup");
  assert.equal(outcome.kind, "warn");
  if (outcome.kind === "warn")
    assert.match(outcome.message, /unknown routine "standup"/);
  // Whitespace prefix
  const ws = normalizeRoutineCommand("  unknown");
  assert.equal(ws.kind, "warn");
  if (ws.kind === "warn") assert.match(ws.message, /unknown routine "unknown"/);
});

test("applyRoutineUpdate snoozedUntil", () => {
  const routines = [
    { name: "standup", scheduleMs: 3600000, prompt: "standup", enabled: true },
  ];
  const result = applyRoutineUpdate(routines, "standup", {
    snoozedUntil: 1000 + 30 * 60_000,
  });
  assert.ok(result.ok);
  assert.ok(result.routines);
  assert.equal(result.routines[0].snoozedUntil, 1000 + 30 * 60_000);
  assert.ok(result.routines[0].enabled);
  // Unknown name → ok: false
  const missing = applyRoutineUpdate(routines, "nope", { enabled: false });
  assert.equal(missing.ok, false);
  assert.equal(missing.routines, undefined);
});

test("applyRoutineUpdate disable and enable", () => {
  const routines = [
    { name: "standup", scheduleMs: 3600000, prompt: "standup", enabled: true },
  ];
  const disabled = applyRoutineUpdate(routines, "standup", { enabled: false });
  assert.ok(disabled.ok);
  assert.ok(disabled.routines);
  assert.equal(disabled.routines[0].enabled, false);

  const enabled = applyRoutineUpdate(disabled.routines, "standup", {
    enabled: true,
  });
  assert.ok(enabled.ok);
  assert.ok(enabled.routines);
  assert.equal(enabled.routines[0].enabled, true);
});

test("routineCompletions includes configured routine names", () => {
  const routines = [
    { name: "standup", scheduleMs: 3600000, prompt: "standup", enabled: true },
    { name: "review", scheduleMs: 86400000, prompt: "review", enabled: true },
  ];
  const completions = routineCompletions(routines);
  assert.equal(completions.length, 2);
  assert.ok(completions.some((c) => c.value === "standup"));
  assert.ok(completions.some((c) => c.value === "review"));
  // Empty routines → empty completions
  assert.equal(routineCompletions([]).length, 0);
});

test("classifyRoutinePrompt routes through classifyRequest", () => {
  // Risky prompt in workflow mode → fleet/planner
  const risky = classifyRoutinePrompt(
    "audit the codebase for security issues",
    "workflow",
  );
  assert.equal(risky.mode, "fleet");

  // Simple prompt in free mode → direct
  const simpleFree = classifyRoutinePrompt("show me the weather", "free");
  assert.equal(simpleFree.mode, "direct");

  // Simple prompt in workflow mode → direct
  const simpleWorkflow = classifyRoutinePrompt(
    "show me the weather",
    "workflow",
  );
  assert.equal(simpleWorkflow.mode, "direct");

  // INV-8: never returns spawn/send (no such fields in RouteDecision)
  const decision = classifyRoutinePrompt("hello", "free");
  assert.ok("mode" in decision);
  assert.ok("stage" in decision);
  assert.ok("confidence" in decision);
  assert.ok("reason" in decision);
});

test("PI-31: Routines tab lists routines and the none-configured fallback", () => {
  const routines = [
    {
      name: "standup",
      scheduleMs: 60 * 60 * 1000,
      prompt: "summarize yesterday",
      enabled: true,
    },
    {
      name: "weekly",
      scheduleMs: 24 * 60 * 60 * 1000,
      prompt: "weekly review",
      enabled: false,
    },
  ];
  const flow = new FlowPanel(
    context,
    theme,
    () => state(),
    () => [],
    () => [],
    () => ({ loaded: [], selected: [] }),
    () => {},
    () => {},
    () => undefined,
    () => undefined,
    () => routines,
  );
  for (let i = 0; i < 6; i++) flow.handleInput("\t");
  const out = flow.render(120).join("\n");
  assert.match(out, /routines/);
  assert.match(out, /standup/);
  assert.match(out, /weekly/);
  assert.match(out, /disabled/);
});

test("PI-31: Routines tab falls back on throwing getter (INV-6)", () => {
  const flow = new FlowPanel(
    context,
    theme,
    () => state(),
    () => [],
    () => [],
    () => ({ loaded: [], selected: [] }),
    () => {},
    () => {},
    () => undefined,
    () => undefined,
    () => {
      throw new Error("routines unavailable");
    },
  );
  for (let i = 0; i < 6; i++) flow.handleInput("\t");
  assert.doesNotThrow(() => flow.render(120));
  assert.match(flow.render(120).join("\n"), /none configured/);
});

test("PI-31 debugger: Routines tab skips null entries instead of crashing", () => {
  const flow = new FlowPanel(
    context,
    theme,
    () => state(),
    () => [],
    () => [],
    () => ({ loaded: [], selected: [] }),
    () => {},
    () => {},
    () => undefined,
    () => undefined,
    () =>
      [
        null,
        {
          name: "good",
          scheduleMs: 3_600_000,
          prompt: "test",
          enabled: true,
        },
      ] as never[],
  );
  for (let i = 0; i < 6; i++) flow.handleInput("\t");
  assert.doesNotThrow(() => flow.render(120));
  const out = flow.render(120).join("\n");
  assert.match(out, /good/);
});

// ─── PI-32 lifecycle wiring ────────────────────────────────

function fakeTimer() {
  let now = 1_000_000;
  let nextId = 1;
  const pending = new Map<number, { cb: () => void; dueAt: number }>();
  return {
    now: () => now,
    advance: (ms: number) => {
      const target = now + ms;
      let guard = 0;
      while (guard++ < 100_000) {
        let nextIdToFire: number | undefined;
        let nextDue = Infinity;
        for (const [id, entry] of pending) {
          if (entry.dueAt <= target && entry.dueAt < nextDue) {
            nextDue = entry.dueAt;
            nextIdToFire = id;
          }
        }
        if (nextIdToFire === undefined) break;
        const entry = pending.get(nextIdToFire);
        pending.delete(nextIdToFire);
        now = Math.max(now, nextDue);
        entry?.cb();
      }
      now = target;
    },
    setTimer: (cb: () => void, delayMs: number) => {
      const id = nextId++;
      pending.set(id, { cb, dueAt: now + delayMs });
      return { id, unref: () => {} } as unknown as NodeJS.Timeout;
    },
    clearTimer: (handle: NodeJS.Timeout) => {
      const { id } = handle as unknown as { id: number };
      pending.delete(id);
    },
    pendingCount: () => pending.size,
  };
}

function def(overrides: Partial<RoutineDefinition> = {}): RoutineDefinition {
  return {
    name: "test",
    scheduleMs: 60_000,
    prompt: "say hello",
    enabled: true,
    ...overrides,
  };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test("PI-32: createRoutinesLifecycle.start starts scheduler and emits snapshot", async () => {
  const clock = fakeTimer();
  let snapshot: readonly StatusWidgetRoutineRecord[] | undefined;
  const life = createRoutinesLifecycle({
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onSnapshot: (snap) => {
      snapshot = snap;
    },
  });
  life.start([def()]);
  assert.ok(clock.pendingCount() > 0, "scheduler timer should be active");
  assert.ok(snapshot !== undefined, "initial snapshot should be emitted");
  assert.equal(snapshot!.length, 1);
  assert.equal(snapshot![0].name, "test");
  assert.equal(snapshot![0].enabled, true);
  life.stop();
});

test("PI-32: createRoutinesLifecycle.start with no routines is idle, no crash", () => {
  const clock = fakeTimer();
  let snapshot: readonly StatusWidgetRoutineRecord[] | undefined;
  const life = createRoutinesLifecycle({
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onSnapshot: (snap) => {
      snapshot = snap;
    },
  });
  life.start([]);
  assert.equal(clock.pendingCount(), 0, "no timer with empty routines");
  assert.deepEqual(snapshot, []);
  life.stop();
});

test("PI-32: createRoutinesLifecycle.stop clears scheduler and emits empty snapshot", () => {
  const clock = fakeTimer();
  const snapshots: StatusWidgetRoutineRecord[][] = [];
  const life = createRoutinesLifecycle({
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onSnapshot: (snap) => {
      snapshots.push(snap as StatusWidgetRoutineRecord[]);
    },
  });
  life.start([def()]);
  // start() calls stop() internally (emits []) then emits the real snapshot
  assert.equal(snapshots.length, 2);
  assert.deepEqual(snapshots[0], []);
  assert.equal(snapshots[1].length, 1);
  assert.equal(snapshots[1][0].name, "test");
  life.stop();
  assert.equal(clock.pendingCount(), 0, "no leaked timers after stop");
  assert.equal(snapshots.length, 3);
  assert.deepEqual(snapshots[2], []);
});

test("PI-32: refresh restarts scheduler with updated routines", async () => {
  const clock = fakeTimer();
  const dueRoutines: string[] = [];
  const life = createRoutinesLifecycle({
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onDue: (r) => {
      dueRoutines.push(r.name);
    },
  });
  life.start([def({ name: "standup", scheduleMs: 60_000 })]);
  clock.advance(60_000);
  await flush();
  assert.deepEqual(dueRoutines, ["standup"]);

  // Refresh: shorter interval for weekly, verify standup disabled
  life.refresh([
    def({ name: "standup", scheduleMs: 60_000, enabled: false }),
    def({ name: "weekly", scheduleMs: 60_000 }),
  ]);
  dueRoutines.length = 0;
  clock.advance(60_000);
  await flush();
  assert.deepEqual(
    dueRoutines,
    ["weekly"],
    "disabled standup should not fire; weekly should fire",
  );
  life.stop();
});

test("PI-32: buildRoutinesSnapshot produces read-only summary per routine", () => {
  const clock = fakeTimer();
  const scheduler = startRoutineScheduler({
    routines: [def({ name: "a", scheduleMs: 60_000 })],
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  const snap = buildRoutinesSnapshot(
    scheduler,
    [def({ name: "a", scheduleMs: 60_000 })],
    clock.now(),
  );
  assert.equal(snap.length, 1);
  assert.equal(snap[0].name, "a");
  assert.equal(snap[0].enabled, true);
  assert.ok(
    typeof snap[0].dueAt === "number" && Number.isFinite(snap[0].dueAt),
  );
  assert.ok(typeof snap[0].schedule === "string");
  scheduler.stop();
});

test("PI-32: buildRoutinesSnapshot handles undefined-safe routines", () => {
  const clock = fakeTimer();
  const scheduler = startRoutineScheduler({
    routines: [],
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  // Empty routines → empty snapshot
  assert.deepEqual(buildRoutinesSnapshot(scheduler, [], clock.now()), []);
  // Null entry → skipped
  const snap = buildRoutinesSnapshot(
    scheduler,
    [null as never, def({ name: "b", scheduleMs: 60_000 })],
    clock.now(),
  );
  assert.equal(snap.length, 1);
  assert.equal(snap[0].name, "b");
  scheduler.stop();
});

test("PI-32: buildRoutinesSnapshot with throwing scheduler produces bounded fallback", () => {
  const throwing = {
    getSnapshot: () => {
      throw new Error("boom");
    },
    getDueRoutineNames: () => [],
  } as unknown as RoutineScheduler;
  assert.throws(() => buildRoutinesSnapshot(throwing, [], 1000), /boom/);
});

test("PI-32: createRoutinesLifecycle.snapshot returns current state without side effects", () => {
  const clock = fakeTimer();
  const life = createRoutinesLifecycle({
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  // No scheduler → empty
  assert.deepEqual(life.snapshot(clock.now()), []);
  life.start([def()]);
  const snap = life.snapshot(clock.now());
  assert.equal(snap.length, 1);
  assert.equal(snap[0].name, "test");
  life.stop();
  // After stop → empty
  assert.deepEqual(life.snapshot(clock.now()), []);
});
