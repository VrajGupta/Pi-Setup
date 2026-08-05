import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { TicketSnapshot } from "../shared/ticket-snapshot.ts";
import type { WorkflowState } from "../shared/workflow-state.ts";
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

function state(): WorkflowState {
  return {
    status: "idle",
    activeStage: null,
    route: {
      mode: "direct",
      stage: null,
      confidence: "high",
      reason: "small and reversible",
      skills: [],
    },
    taskPreview: "",
    stageAgentId: null,
    agentIds: [],
    lastEvent: "",
    updatedAt: 1_000,
  };
}

const snapshot = {
  repo: "VrajGupta/Pi-Setup",
  capturedAt: 1_000,
  records: [
    {
      repo: "VrajGupta/Pi-Setup",
      id: "PI-01",
      title: "planned work",
      status: "planned",
      assignee: "planner",
      blockedBy: [],
      blocking: "unblocked",
      eta: { kind: "unknown" },
    },
    {
      repo: "VrajGupta/Pi-Setup",
      id: "PI-02",
      title: "ready work",
      status: "agent-ready",
      assignee: "coder",
      blockedBy: [{ id: "PI-01", satisfied: true }],
      blocking: "unblocked",
      eta: { kind: "estimated", minMs: 60_000, maxMs: 180_000, n: 3 },
    },
    {
      repo: "VrajGupta/Pi-Setup",
      id: "PI-03",
      title: "active work",
      status: "coding",
      assignee: "coder",
      blockedBy: [{ id: "PI-99", satisfied: false }],
      blocking: "blocked",
      eta: { kind: "unknown" },
    },
    {
      repo: "VrajGupta/Pi-Setup",
      id: "PI-04",
      title: "review work",
      status: "reviewing",
      assignee: "reviewer",
      blockedBy: [],
      blocking: "unblocked",
      eta: { kind: "unknown" },
    },
    {
      repo: "VrajGupta/Pi-Setup",
      id: "PI-05",
      title: "done work",
      status: "done",
      assignee: "reviewer",
      blockedBy: [],
      blocking: "unblocked",
      eta: { kind: "unknown" },
    },
    {
      repo: "VrajGupta/Pi-Setup",
      id: "PI-06",
      title: "dropped work",
      status: "dropped",
      blockedBy: [],
      blocking: "unblocked",
      eta: { kind: "unknown" },
    },
    {
      repo: "VrajGupta/Pi-Setup",
      id: "PI-07",
      title: "unsafe\n\u001b[2Japi_key=snapshot-secret",
      status: "unknown",
      blockedBy: [],
      blocking: "unblocked",
      eta: { kind: "unknown" },
    },
  ],
} satisfies TicketSnapshot;

function issuesPanel(getSnapshot: () => unknown) {
  const flow = new FlowPanel(
    context,
    theme,
    state,
    () => [],
    () => [],
    () => ({ loaded: [], selected: [] }),
    () => {},
    () => {},
    getSnapshot,
  );
  for (let index = 0; index < 5; index += 1) flow.handleInput("\t");
  return flow;
}

test("Issues/Todos renders every snapshot ticket once with explicit monochrome pipeline fields", () => {
  const output = issuesPanel(() => snapshot)
    .render(240)
    .join("\n");

  for (const record of snapshot.records) {
    assert.equal(output.match(new RegExp(`id ${record.id}`, "g"))?.length, 1);
  }
  assert.match(
    output,
    /repo VrajGupta\/Pi-Setup · id PI-02 · title ready work · assignee coder · status ready/,
  );
  assert.match(
    output,
    /blockers PI-01 \(satisfied\) · chain satisfied · eta 60000–180000ms \(n=3\)/,
  );
  assert.match(
    output,
    /status active: coding · blockers PI-99 \(blocked\) · chain blocked · eta unknown/,
  );
  assert.match(output, /status reviewing/);
  assert.match(output, /status done/);
  assert.match(output, /status dropped/);
  assert.match(output, /assignee — · status unknown/);
  assert.doesNotMatch(output, /snapshot-secret|\u001b|\nunsafe/);
});

test("Issues/Todos stays bounded, read-only, pure, fast, and fails visibly", () => {
  const flow = issuesPanel(() => snapshot);
  for (const width of [40, 80, 120]) {
    for (const line of flow.render(width))
      assert.ok(visibleWidth(line) <= width);
  }

  const before = JSON.stringify(state());
  assert.doesNotThrow(() => flow.render(120));
  assert.equal(JSON.stringify(state()), before);

  for (const getSnapshot of [
    () => undefined,
    () => ({ records: "bad" }),
    () => {
      throw new Error("tracker unavailable");
    },
  ]) {
    assert.match(
      issuesPanel(getSnapshot).render(120).join("\n"),
      /issue list unavailable — /,
    );
  }

  const start = performance.now();
  for (let index = 0; index < 1_000; index += 1) flow.render(120);
  assert.ok(performance.now() - start < 2_000);

  const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  const panelSource = source.slice(
    source.indexOf("class FlowPanel"),
    source.indexOf("function formatTokens"),
  );
  assert.doesNotMatch(panelSource, /node:(fs|child_process|http|https|net)/);
  assert.doesNotMatch(panelSource, /\b(fetch|exec|spawn|WebSocket)\s*\(/);
});
