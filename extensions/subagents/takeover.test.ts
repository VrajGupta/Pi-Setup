import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type {
  ExtensionCommandContext,
  KeybindingsManager,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { Component, TUI } from "@earendil-works/pi-tui";
import type { SubagentSnapshot } from "./src/domain.ts";
import type { SubagentReadModel } from "./src/manager.ts";
import {
  openSubagentPicker,
  openSubagentTakeover,
  reconcileDashboardSelection,
  type DashboardSelection,
} from "./src/ui/takeover.ts";

type TakeoverComponent = Component & { dispose?(): void };

type TakeoverFactory = (
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager,
  done: (result: null) => void,
) => TakeoverComponent;

type TakeoverInternals = {
  input: { onSubmit?: (value: string) => void };
};

type DashboardFactory = (
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager,
  done: (result: string | null) => void,
) => TakeoverComponent;

const snapshot = (stage?: SubagentSnapshot["stage"]): SubagentSnapshot => ({
  id: "sa-1",
  origin: "model",
  backend: "codex",
  title: "agent",
  prompt: "prompt",
  cwd: "/tmp",
  status: "running",
  ...(stage === undefined ? {} : { stage }),
  createdAt: 1_000,
  meta: { backend: "codex" },
  usage: {},
  transcript: [],
  liveTools: [],
  queued: [],
  finalText: "",
  turns: 0,
});

async function openForTest(snap: SubagentSnapshot) {
  let component: TakeoverComponent | undefined;
  let closed = false;
  let aborts = 0;
  let sends: string[] = [];
  let renders = 0;
  const tui = {
    requestRender: () => {
      renders++;
    },
    terminal: { rows: 30 },
  } as unknown as TUI;
  const theme = {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  } as unknown as Theme;
  const bindings = new Set<string>();
  const keybindings = {
    matches: (data: string, key: string) => bindings.has(`${data}:${key}`),
  } as unknown as KeybindingsManager;
  const view = {
    get: (id: string) => (id === snap.id ? snap : undefined),
    subscribeTo: () => () => {},
    requestAbort: () => {
      aborts++;
    },
    requestSend: (_id: string, text: string) => {
      sends.push(text);
    },
  } as unknown as SubagentReadModel;
  const factoryContext = {
    ui: {
      custom: async (factory: unknown) => {
        if (typeof factory !== "function") throw new Error("missing factory");
        component = (factory as TakeoverFactory)(
          tui,
          theme,
          keybindings,
          () => {
            closed = true;
          },
        );
        return null;
      },
    },
  } as unknown as ExtensionCommandContext;
  await openSubagentTakeover(factoryContext, view, snap.id);
  if (!component) throw new Error("takeover component was not created");
  return {
    component,
    bindings,
    get aborts() {
      return aborts;
    },
    get sends() {
      return sends;
    },
    get renders() {
      return renders;
    },
    get closed() {
      return closed;
    },
  };
}

test("workflow stage takeover cannot abort, but can scroll and close", async () => {
  const harness = await openForTest(snapshot("debugger"));
  try {
    harness.bindings.add("clear:app.clear");
    harness.component.handleInput?.("clear");
    assert.equal(harness.aborts, 0);

    harness.bindings.add("up:tui.editor.cursorUp");
    harness.component.handleInput?.("up");
    assert.equal(harness.renders, 1);

    harness.bindings.add("escape:app.interrupt");
    harness.component.handleInput?.("escape");
    assert.equal(harness.closed, true);
  } finally {
    harness.component.dispose?.();
  }
});

test("helper takeover retains abort and send behavior", async () => {
  const harness = await openForTest(snapshot());
  try {
    harness.bindings.add("clear:app.clear");
    harness.component.handleInput?.("clear");
    assert.equal(harness.aborts, 1);

    const internals = harness.component as unknown as TakeoverInternals;
    internals.input.onSubmit?.(" follow up ");
    assert.deepEqual(harness.sends, ["follow up"]);
  } finally {
    harness.component.dispose?.();
  }
});

test("dashboard preserves tiny measured context and terminal width with Unicode titles", async () => {
  const snap = {
    ...snapshot(),
    title: "日本語🙂 dashboard title that needs truncation",
    usage: { tokens: 1, contextWindow: 200_000 },
  };
  let component: TakeoverComponent | undefined;
  const tui = {
    requestRender: () => {},
    terminal: { rows: 30 },
  } as unknown as TUI;
  const theme = {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  } as unknown as Theme;
  const keybindings = {
    getKeys: () => [],
    matches: () => false,
  } as unknown as KeybindingsManager;
  const view = {
    size: () => 1,
    list: () => [snap],
    get: (id: string) => (id === snap.id ? snap : undefined),
    subscribe: () => () => {},
  } as unknown as SubagentReadModel;
  const context = {
    ui: {
      custom: async (factory: unknown) => {
        if (typeof factory !== "function") throw new Error("missing factory");
        component = (factory as DashboardFactory)(
          tui,
          theme,
          keybindings,
          () => {},
        );
        return null;
      },
    },
  } as unknown as ExtensionCommandContext;

  await openSubagentPicker(context, view);
  try {
    if (!component) throw new Error("dashboard was not created");
    const lines = component.render(80);
    const output = lines.join("\n");
    assert.match(output, /<1%\/200k/);
    assert.doesNotMatch(output, /0%/);
    assert.ok(lines.every((line) => visibleWidth(line) <= 80));
  } finally {
    component?.dispose?.();
  }
});

test("stage takeover preserves tiny measured context in its width-bounded header", async () => {
  const harness = await openForTest({
    ...snapshot("debugger"),
    title: "日本語🙂 takeover title",
    usage: { tokens: 1, contextWindow: 200_000 },
  });
  try {
    const lines = harness.component.render(80);
    const output = lines.join("\n");
    assert.match(output, /<1%\/200k/);
    assert.doesNotMatch(output, /0%/);
    assert.ok(lines.every((line) => visibleWidth(line) <= 80));
  } finally {
    harness.component.dispose?.();
  }
});

test("workflow stage takeovers never accept typed text", () => {
  const source = readFileSync(
    new URL("./src/ui/takeover.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /this\.input\.onSubmit = \(value: string\) => \{[\s\S]*if \(this\.snap\(\)\?\.stage !== undefined\) return;[\s\S]*requestSend/,
  );
  assert.match(
    source,
    /if \(isStageTakeover\) return;\s*this\.input\.handleInput\(data\)/,
  );
  assert.match(source, /Vraj messages only the coordinator/);
  const tools = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.match(
    tools,
    /if \(snap\.stage\)[\s\S]*throw new Error\([\s\S]*"Workflow stages accept messages only through workflow send\."/,
  );
});

test("dashboard selection follows its subagent id and falls back by row", () => {
  const selection: DashboardSelection = { id: "sa-7", index: 6 };

  reconcileDashboardSelection(selection, [
    { id: "sa-new" },
    ...Array.from({ length: 8 }, (_, index) => ({ id: `sa-${index + 1}` })),
  ]);
  assert.deepEqual(selection, { id: "sa-7", index: 7 });

  reconcileDashboardSelection(selection, [
    ...Array.from({ length: 6 }, (_, index) => ({ id: `sa-${index + 1}` })),
    { id: "sa-8" },
    { id: "sa-9" },
  ]);
  assert.deepEqual(selection, { id: "sa-9", index: 7 });

  reconcileDashboardSelection(selection, [{ id: "sa-1" }, { id: "sa-2" }]);
  assert.deepEqual(selection, { id: "sa-2", index: 1 });

  reconcileDashboardSelection(selection, []);
  assert.deepEqual(selection, { id: undefined, index: 0 });
});
