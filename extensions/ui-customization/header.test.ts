import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SUBAGENT_STATE_CHANNEL,
  WORKFLOW_STATE_CHANNEL,
} from "../shared/workflow-state.ts";
import uiCustomization from "./index.ts";

const theme = { fg: (_color: string, text: string) => text };
type Theme = typeof theme;

test("header keeps only identity while footer retains workflow status", () => {
  type EventHandler = (value: unknown) => void;
  const listeners = new Map<string, Set<EventHandler>>();
  const hooks = new Map<string, (...args: unknown[]) => void>();
  let headerFactory:
    | ((
        tui: { requestRender(): void },
        theme: Theme,
      ) => { render(width: number): string[] })
    | undefined;
  let footerFactory:
    | ((
        tui: { requestRender(): void },
        theme: Theme,
        footerData: { getExtensionStatuses(): Map<string, string> },
      ) => { render(width: number): string[] })
    | undefined;
  const pi = {
    events: {
      on(channel: string, handler: EventHandler) {
        const channelListeners =
          listeners.get(channel) ?? new Set<EventHandler>();
        channelListeners.add(handler);
        listeners.set(channel, channelListeners);
        return () => channelListeners.delete(handler);
      },
      emit(channel: string, value: unknown) {
        for (const handler of listeners.get(channel) ?? []) handler(value);
      },
    },
    on(event: string, handler: (...args: unknown[]) => void) {
      hooks.set(event, handler);
    },
  };
  const context = {
    mode: "tui",
    cwd: "/repo",
    ui: {
      theme,
      setHeader(factory: typeof headerFactory) {
        headerFactory = factory;
      },
      setFooter(factory: typeof footerFactory) {
        footerFactory = factory;
      },
      setTitle() {},
    },
  };

  uiCustomization(pi as never);
  hooks.get("session_start")?.({}, context);
  assert.ok(headerFactory);
  assert.ok(footerFactory);

  const header = headerFactory({ requestRender() {} }, theme);
  const footer = footerFactory({ requestRender() {} }, theme, {
    getExtensionStatuses: () => new Map(),
  });
  pi.events.emit(WORKFLOW_STATE_CHANNEL, {
    status: "running",
    activeStage: "coder",
    route: { mode: "fleet", stage: "coder" },
    updatedAt: Date.now(),
  });
  pi.events.emit(SUBAGENT_STATE_CHANNEL, [
    {
      id: "stage-agent",
      title: "stage agent",
      status: "running",
      backend: "pi",
      stage: "coder",
      startedAt: Date.now(),
      turns: 1,
    },
    {
      id: "helper-agent",
      title: "helper agent",
      status: "done",
      backend: "pi",
      startedAt: Date.now(),
      turns: 1,
    },
  ]);

  const headerOutput = header.render(200).join("\n");
  assert.match(headerOutput, /π \/repo/);
  assert.doesNotMatch(
    headerOutput,
    /FLOW|AGENTS|fleet\/coder|running|coder|1 running|2 tracked/i,
  );

  const footerOutput = footer.render(200).join("\n");
  assert.match(footerOutput, /fleet\/coder/);
  assert.match(footerOutput, /running/);
  assert.match(footerOutput, /coder/);
  assert.match(footerOutput, /1 running · 2 tracked/);
});
