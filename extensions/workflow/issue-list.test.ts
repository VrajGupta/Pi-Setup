import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { TicketSnapshot } from "../shared/ticket-snapshot.ts";
import type { WorkflowState } from "../shared/workflow-state.ts";
import {
  FlowPanel,
  type FlowPanelContext,
  type RepositoryView,
} from "./index.ts";

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
  capturedAt: Date.now(),
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

const localView: RepositoryView = {
  defaulted: false,
  reads: [
    {
      path: "/repo",
      repo: snapshot.repo,
      capturedAt: snapshot.capturedAt,
      snapshot,
    },
  ],
};

function record(id: string, title: string, repo: string) {
  return {
    repo,
    id,
    title,
    status: "done" as const,
    blockedBy: [],
    blocking: "unblocked" as const,
    eta: { kind: "unknown" as const },
  };
}

function issuesPanel(getView: () => unknown) {
  const flow = new FlowPanel(
    context,
    theme,
    state,
    () => [],
    () => [],
    () => ({ loaded: [], selected: [] }),
    () => {},
    () => {},
    undefined,
    getView as () => RepositoryView | undefined,
  );
  for (let index = 0; index < 5; index += 1) flow.handleInput("\t");
  return flow;
}

function legacyIssuesPanel(getSnapshot: () => unknown) {
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
  const output = issuesPanel(() => localView)
    .render(240)
    .join("\n");

  for (const record of snapshot.records) {
    assert.equal(output.match(new RegExp(`id ${record.id}`, "g"))?.length, 1);
  }
  assert.match(output, /repo VrajGupta\/Pi-Setup · 7 tickets/);
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

test("tickets are grouped by repository and never render under a repository they did not come from", () => {
  const alpha: TicketSnapshot = {
    repo: "alpha",
    capturedAt: Date.now(),
    records: [record("T-1", "alpha title", "alpha")],
  };
  const beta: TicketSnapshot = {
    repo: "beta",
    capturedAt: Date.now(),
    records: [record("T-1", "beta title", "beta")],
  };
  const output = issuesPanel(() => ({
    defaulted: false,
    reads: [
      {
        path: "/work/alpha",
        repo: "alpha",
        capturedAt: Date.now(),
        snapshot: alpha,
      },
      {
        path: "/work/beta",
        repo: "beta",
        capturedAt: Date.now(),
        snapshot: beta,
      },
      {
        path: "/work/gamma",
        repo: "gamma",
        capturedAt: Date.now(),
        snapshot: {
          repo: "delta",
          capturedAt: Date.now(),
          records: [record("T-2", "cross-repo leak", "delta")],
        },
      },
    ],
  }))
    .render(240)
    .join("\n");

  // Shared ticket IDs render once per repository, each under its own header.
  assert.equal(output.match(/id T-1/g)?.length, 2);
  const alphaHeader = output.indexOf(" repo alpha · 1 ticket");
  const betaHeader = output.indexOf(" repo beta · 1 ticket");
  assert.ok(alphaHeader >= 0 && betaHeader > alphaHeader);
  assert.ok(output.indexOf("title alpha title") < betaHeader);
  assert.ok(output.indexOf("title beta title") > betaHeader);
  assert.match(output, /repo gamma — unavailable — invalid snapshot/);
  assert.doesNotMatch(output, /cross-repo leak/);

  const legacyOutput = legacyIssuesPanel(() => ({
    ...alpha,
    records: [record("T-2", "cross-repo leak", "beta")],
  }))
    .render(120)
    .join("\n");
  assert.match(legacyOutput, /issue list unavailable — invalid snapshot/);
  assert.doesNotMatch(legacyOutput, /cross-repo leak/);
});

test("an unavailable repository degrades that section only; the others still render", () => {
  const alpha: TicketSnapshot = {
    repo: "alpha",
    capturedAt: Date.now(),
    records: [record("T-1", "alpha title", "alpha")],
  };
  const gamma: TicketSnapshot = {
    repo: "gamma",
    capturedAt: Date.now(),
    records: [record("T-2", "gamma title", "gamma")],
  };
  const okAlpha = {
    path: "/work/alpha",
    repo: "alpha",
    capturedAt: alpha.capturedAt,
    snapshot: alpha,
  };
  const okGamma = {
    path: "/work/gamma",
    repo: "gamma",
    capturedAt: gamma.capturedAt,
    snapshot: gamma,
  };
  for (const reason of [
    "no tracker",
    "timeout",
    "unreadable",
    "empty tracker",
  ]) {
    const output = issuesPanel(() => ({
      defaulted: false,
      reads: [
        okAlpha,
        {
          path: "/work/beta",
          repo: "beta",
          capturedAt: Date.now(),
          reason,
        },
        okGamma,
      ],
    }))
      .render(240)
      .join("\n");
    assert.match(output, new RegExp(` repo beta — unavailable — ${reason}`));
    assert.match(output, /title alpha title/);
    assert.match(output, /title gamma title/);
  }

  const emptySnapshotOutput = issuesPanel(() => ({
    defaulted: false,
    reads: [
      {
        path: "/work/beta",
        repo: "beta",
        capturedAt: Date.now(),
        snapshot: {
          repo: "beta",
          capturedAt: Date.now(),
          records: [],
          reason: "empty tracker",
        },
      },
    ],
  }))
    .render(120)
    .join("\n");
  assert.match(emptySnapshotOutput, /repo beta — unavailable — empty tracker/);
  assert.doesNotMatch(emptySnapshotOutput, /0 tickets/);
});

test("with no registry configured the view shows this repository only and says so", () => {
  const output = issuesPanel(() => ({
    defaulted: true,
    reads: [
      {
        path: "/repo",
        repo: snapshot.repo,
        capturedAt: Date.now(),
        snapshot,
      },
    ],
  }))
    .render(240)
    .join("\n");
  assert.match(output, / registry default: this repository only/);
  assert.match(output, /repo VrajGupta\/Pi-Setup · 7 tickets/);
  assert.match(output, /id PI-01/);
});

test("a stale snapshot renders with ~ and its age, never as current", () => {
  const alpha: TicketSnapshot = {
    repo: "alpha",
    capturedAt: Date.now() - 31_000,
    records: [record("T-1", "alpha title", "alpha")],
  };
  const beta: TicketSnapshot = {
    repo: "beta",
    capturedAt: Date.now(),
    records: [record("T-2", "beta title", "beta")],
  };
  const output = issuesPanel(() => ({
    defaulted: false,
    reads: [
      {
        path: "/work/alpha",
        repo: "alpha",
        capturedAt: Date.now(),
        snapshot: alpha,
      },
      {
        path: "/work/beta",
        repo: "beta",
        capturedAt: Date.now(),
        snapshot: beta,
      },
    ],
  }))
    .render(240)
    .join("\n");
  assert.match(output, / repo alpha · 1 ticket · ~ \d+s/);
  assert.doesNotMatch(output, / repo beta · 1 ticket · ~/);
});

test("legacy single-snapshot fallback validates and rejects hostile fields", () => {
  const output = legacyIssuesPanel(() => snapshot)
    .render(240)
    .join("\n");
  assert.match(output, /id PI-01/);

  const duplicate = {
    ...snapshot,
    records: [snapshot.records[0]!, snapshot.records[0]!],
  } satisfies TicketSnapshot;
  assert.match(
    legacyIssuesPanel(() => duplicate)
      .render(120)
      .join("\n"),
    /issue list unavailable — invalid snapshot/,
  );

  const hostile = {
    ...snapshot,
    repo: "",
    records: [
      {
        ...snapshot.records[0]!,
        repo: "",
        id: "PI-99",
        title:
          'DATABASE_URL=postgres://user:SYNTHETIC_DB_PASSWORD@db.example/app password="SYNTHETIC_UNTERMINATED_SECRET TAIL\nAWS_ACCESS_KEY_ID=SYNTHETIC_AWS_SECRET\nsip:user:SYNTHETIC_SIP_SECRET@example.test',
        assignee: undefined,
      },
    ],
  };
  const hostileOutput = legacyIssuesPanel(() => hostile)
    .render(240)
    .join("\n");
  assert.match(hostileOutput, /repo — · id PI-99/);
  assert.match(hostileOutput, /assignee —/);
  assert.doesNotMatch(
    hostileOutput,
    /SYNTHETIC_DB_PASSWORD|SYNTHETIC_UNTERMINATED_SECRET|TAIL|SYNTHETIC_AWS_SECRET|SYNTHETIC_SIP_SECRET/,
  );

  const hostileRepo = "Authorization: Bearer SYNTHETIC_REPO\u001b[2J";
  const hostileRepoLines = issuesPanel(() => ({
    defaulted: false,
    reads: [
      {
        path: "/work/hostile",
        repo: hostileRepo,
        capturedAt: Date.now(),
        snapshot: {
          repo: hostileRepo,
          capturedAt: Date.now(),
          records: [
            record(
              "PI-98",
              "title\napi_key=SYNTHETIC_TITLE_SECRET",
              hostileRepo,
            ),
          ],
        },
      },
    ],
  })).render(240);
  const hostileRepoOutput = hostileRepoLines.join("\n");
  assert.doesNotMatch(
    hostileRepoOutput,
    /SYNTHETIC_REPO|SYNTHETIC_TITLE_SECRET|\u001b\[2J/,
  );
  assert.ok(hostileRepoLines.every((line) => !line.includes("\n")));
});

test("Issues/Todos does not reuse rows after a malformed snapshot", () => {
  let current: unknown = snapshot;
  const flow = legacyIssuesPanel(() => current);
  assert.match(flow.render(120).join("\n"), /id PI-01/);

  current = {
    ...snapshot,
    get records(): never {
      throw new Error("snapshot corrupted");
    },
  };
  assert.match(
    flow.render(120).join("\n"),
    /issue list unavailable — snapshot unavailable/,
  );
  assert.match(
    flow.render(120).join("\n"),
    /issue list unavailable — snapshot unavailable/,
  );
});

test("Issues/Todos stays bounded, read-only, pure, fast, and fails visibly", () => {
  const flow = issuesPanel(() => localView);
  for (const width of [40, 80, 120]) {
    for (const line of flow.render(width))
      assert.ok(visibleWidth(line) <= width);
  }

  const before = JSON.stringify(state());
  assert.doesNotThrow(() => flow.render(120));
  assert.equal(JSON.stringify(state()), before);

  for (const getView of [
    () => undefined,
    () => ({ defaulted: false, reads: "bad" }),
    () => ({ defaulted: false, reads: [] }),
    () => ({
      defaulted: "yes",
      reads: [localView.reads[0]],
    }),
    () => {
      throw new Error("tracker unavailable");
    },
  ]) {
    assert.match(
      issuesPanel(getView).render(120).join("\n"),
      /issue list unavailable — /,
    );
  }
  assert.match(
    issuesPanel(() => ({
      defaulted: false,
      reads: [
        {
          path: "/work/beta",
          repo: "beta",
          capturedAt: Date.now(),
          reason: "",
        },
      ],
    }))
      .render(120)
      .join("\n"),
    /repo beta — unavailable — unknown/,
  );

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
  const renderSource = source.slice(
    source.indexOf("function issueRow"),
    source.indexOf("export function resolveRepositories"),
  );
  assert.doesNotMatch(renderSource, /node:(fs|child_process|http|https|net)/);
  assert.doesNotMatch(
    renderSource,
    /\b(readFile|fetch|exec|spawn|WebSocket)\s*\(/,
  );
});
