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
) {
  return new FlowPanel(
    context,
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
    agent({ id: "p4", stage: "part4" }),
    agent({ id: "p2", stage: "part2" }),
    agent({ id: "p1", stage: "part1" }),
  ]);
  agentsTab(flow);

  const output = flow.render(120).join("\n");
  assert.ok(output.indexOf("part1") < output.indexOf("part2"));
  assert.ok(output.indexOf("part2") < output.indexOf("part4"));
  assert.ok(output.indexOf("part4") < output.indexOf("helper"));
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

test("panel rows fit widths 40 and 120", () => {
  const flow = panel(
    state({
      status: "blocked",
      lastEvent: "a very long reason that must remain bounded in the panel",
      route: {
        mode: "fleet",
        stage: "part2",
        confidence: "high",
        reason:
          "the request spans several modules and needs independent review",
        skills: [],
      },
    }),
    [
      agent({
        stage: "part1",
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

test("stage readings use shared measured progress and omit percent when indeterminate", () => {
  const measured = panel(state(), [
    agent({ stage: "part2", contextTokens: 1, contextWindow: 2 }),
  ]);
  agentsTab(measured);
  assert.match(measured.render(120).join("\n"), /50%/);

  const indeterminate = panel(state(), [agent({ stage: "part2" })]);
  agentsTab(indeterminate);
  assert.doesNotMatch(indeterminate.render(120).join("\n"), /%/);
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
