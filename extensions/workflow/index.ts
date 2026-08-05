import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
  SUBAGENT_BRIDGE_CHANNEL,
  SUBAGENT_STATE_CHANNEL,
  STAGE_NAMES,
  WORKFLOW_STATE_CHANNEL,
  emptyWorkflowState,
  isWorkflowSubagentSummary,
  type StageName,
  type WorkflowBridgeRequest,
  type WorkflowBridgeResponse,
  type WorkflowState,
  type WorkflowReasoningEffort,
  type WorkflowSubagentSummary,
} from "../shared/workflow-state.ts";
import { buildReading, isStale } from "../shared/stage-progress.ts";
import { notifyNative } from "../shared/notify-native.ts";
import {
  STAGE_PROFILES,
  buildStagePrompt,
  classifyRequest,
  parseControlEnvelope,
  type ControlEnvelope,
  type RouteDecision,
} from "./src/policy.ts";
import { assembleWorkflowSystemPrompt } from "./prompt-assembly.ts";

const REASONING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
const CAPABILITY_CHANNEL = "vraj:capability-used";
const CONTROL_MESSAGE_TYPE = "subagent-result";

interface FlowInput {
  action: "route" | "start" | "send" | "status" | "recover";
  prompt?: string;
  stage?: StageName;
  reasoning_effort?: (typeof REASONING_LEVELS)[number];
  id?: string;
  text?: string;
}

function preview(text: string, max = 160) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function projectKey(cwd: string) {
  const value = cwd.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-|-$/g, "");
  return value || "home";
}

function statePath(cwd: string) {
  return join(getAgentDir(), "workflows", `${projectKey(cwd)}.json`);
}

function isControlResponse(prompt: string) {
  return /\b(question_answers|helper_result)\b/.test(prompt);
}

function modelLabel(ctx: Pick<ExtensionContext, "model">) {
  if (!ctx.model) return "no model";
  return `${displayText(ctx.model.provider, "?")}/${displayText(ctx.model.id, "?")}`;
}

export type FlowPanelContext = Pick<
  ExtensionContext,
  "cwd" | "model" | "thinkingLevel" | "getContextUsage"
> & {
  sessionManager: Pick<ExtensionContext["sessionManager"], "getSessionFile">;
  getAgentsUpdatedAt?: () => number | undefined;
};

type FlowPanelTheme = Pick<
  ExtensionContext["ui"]["theme"],
  "bg" | "fg" | "bold"
>;

// Model- and agent-provided text is untrusted display data. Strip terminal
// controls before trusted theme styling, then keep it on one physical row.
// eslint-disable-next-line no-control-regex
const OSC_PATTERN =
  /(?:\u001b\]|\u009d)(?:[^\u0007\u001b\u009c]|\u001b(?!\\))*(?:\u0007|\u001b\\|\u009c)/g;
// eslint-disable-next-line no-control-regex
const CSI_PATTERN = /(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]/g;
// eslint-disable-next-line no-control-regex
const ESCAPE_PATTERN = /\u001b(?:[()][0-2A-Z]|[ -/]*[@-~])/g;
// Header values are opaque display data: do not inspect quote or delimiter
// structure. Folded continuation lines belong to the preceding header; stop at
// the next non-indented line or another sensitive header.
const SENSITIVE_HEADER_PATTERN =
  /\b(Authorization|Cookie)[ \t]*:[ \t]*[^\r\n]*?(?:\r?\n[ \t]+[^\r\n]*?)*(?=\r?\n(?![ \t])|[ \t]+\b(?:Authorization|Cookie)[ \t]*:|$)/gi;

function stringify(value: unknown, fallback = "") {
  try {
    return value === undefined || value === null ? fallback : String(value);
  } catch {
    return fallback;
  }
}

function redactSecrets(text: string) {
  return text
    .replace(SENSITIVE_HEADER_PATTERN, "$1: [REDACTED]")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [REDACTED]")
    .replace(
      /\b(sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,})\b/g,
      "[REDACTED]",
    )
    .replace(
      /(["']?(?:api[_-]?key|access[_-]?key|authorization|cookie|credential|password|passwd|private[_-]?key|secret|token)["']?\s*[:=]\s*)(["']?)[^\s,;}]+\2/gi,
      "$1[REDACTED]",
    )
    .replace(
      /([?&](?:api[_-]?key|access[_-]?token|key|secret|token)=)[^&#\s]+/gi,
      "$1[REDACTED]",
    );
}

function displayText(value: unknown, fallback = "") {
  const clean = stringify(value, fallback)
    .replace(OSC_PATTERN, "")
    .replace(CSI_PATTERN, "")
    .replace(ESCAPE_PATTERN, "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "");
  return redactSecrets(clean)
    .replace(/\r\n?|\n|\t/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\bhttps?:\/\/[^\s]+/gi, "[URL]");
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function safeElapsed(now: unknown, startedAt: unknown) {
  const safeNow = finiteNumber(now);
  const safeStartedAt = finiteNumber(startedAt);
  return safeNow === undefined || safeStartedAt === undefined
    ? 0
    : Math.max(0, safeNow - safeStartedAt);
}

function safeTurns(value: unknown) {
  const turns = finiteNumber(value);
  return turns === undefined || turns < 0 ? 0 : Math.floor(turns);
}

function normalizeWidth(width: unknown) {
  if (typeof width !== "number" || !Number.isFinite(width)) return 0;
  return Math.max(0, Math.floor(width));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isKnownStage(value: unknown): value is StageName {
  return typeof value === "string" && STAGE_NAMES.includes(value as StageName);
}

function readState(getState: () => WorkflowState) {
  try {
    const value: unknown = getState();
    return isRecord(value)
      ? (value as unknown as WorkflowState)
      : emptyWorkflowState();
  } catch {
    return emptyWorkflowState();
  }
}

function readAgents(getAgents: () => WorkflowSubagentSummary[]) {
  try {
    const value: unknown = getAgents();
    return Array.isArray(value) ? value.filter(isRecord) : [];
  } catch {
    return [];
  }
}

function readTimestamp(
  getter: (() => number | undefined) | undefined,
  fallback: number,
) {
  try {
    const value = getter?.();
    return finiteNumber(value) ?? fallback;
  } catch {
    return fallback;
  }
}

export class FlowPanel {
  private tab = 0;
  private readonly tabs = [
    "Overview",
    "Workflow",
    "Agents",
    "Capabilities",
    "Session",
  ];
  private readonly ctx: FlowPanelContext;
  private readonly theme: FlowPanelTheme;
  private readonly getState: () => WorkflowState;
  private readonly getAgents: () => WorkflowSubagentSummary[];
  private readonly getUsed: () => string[];
  private readonly getCapabilities: () => {
    loaded: string[];
    selected: string[];
  };
  private readonly done: () => void;
  private readonly rerender: () => void;

  constructor(
    ctx: FlowPanelContext,
    theme: FlowPanelTheme,
    getState: () => WorkflowState,
    getAgents: () => WorkflowSubagentSummary[],
    getUsed: () => string[],
    getCapabilities: () => { loaded: string[]; selected: string[] },
    done: () => void,
    rerender: () => void,
  ) {
    this.ctx = ctx;
    this.theme = theme;
    this.getState = getState;
    this.getAgents = getAgents;
    this.getUsed = getUsed;
    this.getCapabilities = getCapabilities;
    this.done = done;
    this.rerender = rerender;
  }

  handleInput(data: string) {
    if (typeof data !== "string") return;
    if (matchesKey(data, Key.escape)) {
      this.done();
      return;
    }
    if (matchesKey(data, Key.left)) {
      this.tab = (this.tab + this.tabs.length - 1) % this.tabs.length;
      this.rerender();
      return;
    }
    if (matchesKey(data, Key.right) || matchesKey(data, Key.tab)) {
      this.tab = (this.tab + 1) % this.tabs.length;
      this.rerender();
    }
  }

  render(width: number) {
    const state = readState(this.getState);
    const agents = readAgents(this.getAgents);
    const now = finiteNumber(Date.now()) ?? 0;
    const safeWidth = normalizeWidth(width);
    const agentsUpdatedAt = readTimestamp(this.ctx.getAgentsUpdatedAt, now);
    const running = agents.filter((agent) => agent.status === "running").length;
    const tabs = this.tabs
      .map((tab, index) =>
        index === this.tab
          ? this.theme.bg(
              "selectedBg",
              this.theme.fg("accent", this.theme.bold(` ${tab} `)),
            )
          : this.theme.fg("dim", ` ${tab} `),
      )
      .join(this.theme.fg("borderMuted", " · "));
    const status = displayText(state.status, "unknown");
    const activeStage = isKnownStage(state.activeStage)
      ? ` · ${state.activeStage}`
      : "";
    const title =
      this.theme.fg("accent", this.theme.bold(" π  FLOW CONTROL CENTER ")) +
      this.theme.fg(
        "muted",
        ` · ${status}${activeStage} · ${running} agent${running === 1 ? "" : "s"}`,
      );
    const lines = [
      title,
      tabs,
      this.theme.fg("borderMuted", "─".repeat(Math.max(1, safeWidth - 4))),
      ...this.content(state, agents, now, agentsUpdatedAt),
      "",
      this.theme.fg("dim", " ←/→ or tab switch · esc close"),
    ];
    return this.frame(lines, width);
  }

  invalidate() {}

  private frame(lines: string[], width: number) {
    const frameWidth = normalizeWidth(width);
    if (frameWidth === 0) return lines.map(() => "");
    const border = this.theme.fg("borderAccent", "│");
    const fill = (line: string) => {
      const clipped = truncateToWidth(line, frameWidth);
      return this.theme.bg(
        "customMessageBg",
        `${clipped}${" ".repeat(Math.max(0, frameWidth - visibleWidth(clipped)))}`,
      );
    };
    const body = (line: string) => {
      if (frameWidth === 1) return fill(border);
      if (frameWidth === 2) return fill(`${border}${border}`);
      if (frameWidth === 3) return fill(`${border} ${border}`);
      const textWidth = frameWidth - 4;
      const clipped = truncateToWidth(line, textWidth);
      return fill(
        `${border} ${clipped}${" ".repeat(Math.max(0, textWidth - visibleWidth(clipped)))} ${border}`,
      );
    };
    const horizontal = "─".repeat(Math.max(0, frameWidth - 2));
    return [
      fill(
        this.theme.fg(
          "borderAccent",
          frameWidth === 1 ? border : `╭${horizontal}╮`,
        ),
      ),
      ...lines.map(body),
      fill(
        this.theme.fg(
          "borderAccent",
          frameWidth === 1 ? border : `╰${horizontal}╯`,
        ),
      ),
    ];
  }

  private content(
    state: WorkflowState,
    agents: Record<string, unknown>[],
    now: number,
    agentsUpdatedAt: number,
  ) {
    switch (this.tab) {
      case 1:
        return this.workflow(state);
      case 2:
        return this.agents(state, agents, now, agentsUpdatedAt);
      case 3:
        return this.capabilities();
      case 4:
        return this.session(state);
      default:
        return this.overview(state, agents, now);
    }
  }

  private overview(
    state: WorkflowState,
    agents: Record<string, unknown>[],
    now: number,
  ) {
    let usage: unknown;
    try {
      usage = this.ctx.getContextUsage();
    } catch {
      usage = undefined;
    }
    const context = contextDisplay(usage, now);
    const waiting = waitingOn(state);
    return [
      this.theme.fg("mdHeading", " snapshot"),
      ` ${displayText(this.ctx.cwd, "?")}`,
      ` route   ${routeText(state.route)}`,
      ` why this route  ${routeReason(state.route)}`,
      ` status  ${displayText(state.status, "unknown")}${isKnownStage(state.activeStage) ? ` · ${state.activeStage}` : ""}`,
      ...(waiting ? [waiting] : []),
      ` model   ${modelLabel(this.ctx)}`,
      ` think   ${displayText(this.ctx.thinkingLevel, "?")} · context ${context.percent}/${context.window}`,
      ` agents  ${agents.filter((agent) => agent.status === "running").length} running · ${agents.length} tracked`,
      displayText(state.lastEvent)
        ? ` event   ${displayText(state.lastEvent)}`
        : "",
    ];
  }

  private workflow(state: WorkflowState) {
    return [
      " workflow rail",
      ` ${rail(state.activeStage, state.status)}`,
      ` task    ${displayText(state.taskPreview, "none") || "none"}`,
      ` stage   ${displayText(state.activeStage, "none") || "none"}`,
      ` agent   ${displayText(state.stageAgentId, "none") || "none"}`,
      "",
      " Stage models",
      ...STAGE_NAMES.map((stage) => {
        const profile = STAGE_PROFILES[stage];
        return ` ${stage}  ${profile.harness}/${profile.model} · ${profile.defaultReasoning}`;
      }),
    ];
  }

  private agents(
    state: WorkflowState,
    agents: Record<string, unknown>[],
    now: number,
    agentsUpdatedAt: number,
  ) {
    if (agents.length === 0) return [" agents", " none tracked"];
    return [
      " agents",
      ...agents
        .map((agent, index) => ({ agent, index }))
        .sort(
          (a, b) =>
            stageIndex(a.agent.stage) - stageIndex(b.agent.stage) ||
            a.index - b.index,
        )
        .map(({ agent }) => agentText(agent, state, now, agentsUpdatedAt)),
    ];
  }

  private capabilities() {
    let capabilities: { loaded: string[]; selected: string[] } = {
      loaded: [],
      selected: [],
    };
    let used: string[] = [];
    try {
      const candidate = this.getCapabilities();
      if (candidate && typeof candidate === "object") capabilities = candidate;
    } catch {
      // A capability provider is auxiliary to the control center.
    }
    try {
      const candidate = this.getUsed();
      if (Array.isArray(candidate)) used = candidate;
    } catch {
      // A capability provider is auxiliary to the control center.
    }
    const loaded = Array.isArray(capabilities.loaded)
      ? capabilities.loaded.map((value) => displayText(value))
      : [];
    const selected = Array.isArray(capabilities.selected)
      ? capabilities.selected.map((value) => displayText(value))
      : [];
    return [
      " capabilities",
      ` loaded skills    ${loaded.join(", ") || "none"}`,
      ` selected tools   ${selected.join(", ") || "none"}`,
      ` invoked this run ${Array.isArray(used) ? used.map((value) => displayText(value)).join(", ") || "none" : "none"}`,
    ];
  }

  private session(state: WorkflowState) {
    let file: string | undefined;
    try {
      file = this.ctx.sessionManager.getSessionFile();
    } catch {
      file = undefined;
    }
    return [
      " session",
      ` file    ${typeof file === "string" ? displayText(relative(homedir(), file)) : "ephemeral"}`,
      ` project ${displayText(this.ctx.cwd, "?")}`,
      ` state   ${displayText(state.status, "unknown")}`,
      ` updated ${formatUpdatedAt(state.updatedAt)}`,
      "",
      " Recovery is evidence-based. Re-check the tracker, git, gate, and agent transcript before resuming.",
    ];
  }
}

function formatTokens(tokens: number) {
  const safeTokens = finiteNumber(tokens);
  if (safeTokens === undefined) return "?";
  if (safeTokens < 1_000) return `${safeTokens}`;
  if (safeTokens < 1_000_000) return `${Math.round(safeTokens / 1_000)}k`;
  return `${(safeTokens / 1_000_000).toFixed(1)}m`;
}

function contextDisplay(usage: unknown, now: number) {
  const value = isRecord(usage) ? usage : {};
  const contextWindow = finiteNumber(value.contextWindow);
  const reading = buildReading({
    source: "context",
    done: finiteNumber(value.tokens),
    total: contextWindow,
    at: now,
  });
  return {
    percent:
      reading.kind === "measured" ? `${Math.round(reading.percent)}%` : "?",
    window:
      contextWindow !== undefined && contextWindow > 0
        ? formatTokens(contextWindow)
        : "?",
  };
}

function formatUpdatedAt(value: unknown) {
  const timestamp = finiteNumber(value);
  return timestamp === undefined
    ? "unknown"
    : new Date(timestamp).toLocaleString();
}

function statusGlyph(status: unknown) {
  return status === "running" ? "·" : status === "done" ? "✓" : "×";
}

function stageIndex(stage: unknown) {
  const index = isKnownStage(stage) ? STAGE_NAMES.indexOf(stage) : -1;
  return index < 0 ? STAGE_NAMES.length : index;
}

function formatElapsed(elapsedMs: unknown) {
  const seconds = Math.max(
    0,
    Math.floor((finiteNumber(elapsedMs) ?? 0) / 1_000),
  );
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h${minutes % 60}m`;
}

function stageReason(
  agent: Record<string, unknown>,
  state: WorkflowState,
  stale: boolean,
) {
  const event = displayText(state.lastEvent);
  if (agent.status === "error") {
    // Only label a provider cause when the event is actually provider-shaped;
    // a generic error must render reason unknown, never a fabricated cause.
    return /\b(provider|authorization|timeout|rate limit|quota|spend|unavailable)\b|\b5\d\d\b/i.test(
      event,
    )
      ? `provider error: ${event}`
      : "reason unknown";
  }
  if (agent.stage === state.activeStage) {
    if (state.status === "needs-input") return "waiting on question";
    if (state.status === "needs-helper") return "waiting on helper";
    if (state.status === "blocked") {
      if (/\b(quota|spend|rate limit|limit reached)\b/i.test(event))
        return "quota limit";
      if (
        /\b(provider|authorization|timeout|unavailable)\b|\b5\d\d\b/i.test(
          event,
        )
      )
        return `provider error: ${event}`;
    }
  }
  if (stale) return "stale bridge";
  return agent.stage === state.activeStage && state.status === "running"
    ? "working"
    : "reason unknown";
}

function agentText(
  agent: Record<string, unknown>,
  state: WorkflowState,
  now: number,
  agentsUpdatedAt: number,
) {
  const stageAgent = isKnownStage(agent.stage);
  const reading = buildReading({
    source: "context",
    done: finiteNumber(agent.contextTokens),
    total: finiteNumber(agent.contextWindow),
    at: agentsUpdatedAt,
    elapsedMs: safeElapsed(now, agent.startedAt),
    turns: safeTurns(agent.turns),
  });
  const progress =
    stageAgent && reading.kind === "measured"
      ? ` · ${reading.percent > 0 && reading.percent < 1 ? "<1" : Math.round(reading.percent)}% ctx`
      : "";
  const bridgeStale = isStale(reading, now);
  const stale = reading.kind === "indeterminate" || bridgeStale;
  const rawReason = stageAgent ? stageReason(agent, state, bridgeStale) : "";
  // INV-1: a row with no measured reading renders no % at all, including
  // inside its reason text (e.g. a provider detail like "50% failure").
  const reason =
    stageAgent && reading.kind !== "measured"
      ? rawReason.replace(/%/g, "")
      : rawReason;
  return `${stale ? " ~ " : " "}${reason ? `${reason} · ` : ""}${statusGlyph(agent.status)} ${stageAgent ? agent.stage : "helper"} · ${displayText(agent.id, "?")} · ${displayText(agent.title, "?")} · ${displayText(agent.backend, "?")}/${displayText(agent.modelLabel, "?") || "?"} · ${formatElapsed(safeElapsed(now, agent.startedAt))} · ${safeTurns(agent.turns)}t${progress}`;
}

function rail(activeStage: StageName | null, status: WorkflowState["status"]) {
  return STAGE_NAMES.map((stage) => {
    if (stage === activeStage) return `◉ ${stage}`;
    if (
      status === "complete" ||
      (activeStage &&
        STAGE_NAMES.indexOf(stage) < STAGE_NAMES.indexOf(activeStage))
    ) {
      return `✓ ${stage}`;
    }
    return `· ${stage}`;
  }).join("  →  ");
}

function routeText(route: RouteDecision | WorkflowState["route"]) {
  if (!isRecord(route)) return "not classified";
  const mode = displayText(route.mode, "unknown");
  const stage = isKnownStage(route.stage) ? ` · ${route.stage}` : "";
  return `${mode}${stage}`;
}

function routeReason(route: RouteDecision | WorkflowState["route"]) {
  if (!isRecord(route)) return "No route has been chosen yet.";
  const mode = displayText(route.mode, "unknown");
  const routeName = isKnownStage(route.stage) ? `${mode}/${route.stage}` : mode;
  const reason =
    displayText(route.reason)
      .trim()
      .replace(/[.!?]+$/, "") || "no reason was recorded";
  return `The ${routeName} route was chosen because ${reason}.`;
}

function waitingOn(state: WorkflowState) {
  const event = displayText(state.lastEvent);
  if (state.status === "needs-input")
    return ` waiting on  ${event || "your input"}`;
  if (state.status === "needs-helper")
    return ` waiting on  ${event || "a helper result"}`;
  if (state.status === "blocked")
    return ` waiting on  ${event || "a recovery path"}`;
  return undefined;
}

function isFlowInput(value: unknown): value is FlowInput {
  if (!value || typeof value !== "object") return false;
  const input = value as Record<string, unknown>;
  return (
    (input.action === "route" ||
      input.action === "start" ||
      input.action === "send" ||
      input.action === "status" ||
      input.action === "recover") &&
    (input.stage === undefined ||
      STAGE_NAMES.includes(input.stage as StageName)) &&
    (input.reasoning_effort === undefined ||
      REASONING_LEVELS.includes(
        input.reasoning_effort as (typeof REASONING_LEVELS)[number],
      ))
  );
}

export default function workflow(pi: ExtensionAPI) {
  let state = emptyWorkflowState();
  let context: ExtensionContext | undefined;
  let agents: WorkflowSubagentSummary[] = [];
  let agentsUpdatedAt = Date.now();
  const usedCapabilities = new Set<string>();
  let requestRender: (() => void) | undefined;
  let lastEnvelope = "";

  const publish = () => {
    state = { ...state, updatedAt: Date.now() };
    pi.events.emit(WORKFLOW_STATE_CHANNEL, { ...state });
    void persist();
    requestRender?.();
  };

  const setState = (patch: Partial<WorkflowState>) => {
    state = { ...state, ...patch };
    publish();
  };

  const persist = async () => {
    if (!context) return;
    const path = statePath(context.cwd);
    const temporary = `${path}.${process.pid}.tmp`;
    try {
      await mkdir(join(getAgentDir(), "workflows"), { recursive: true });
      await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
      await rename(temporary, path);
    } catch {
      // Runtime state is useful, never a reason to break a coding session.
    }
  };

  const bridge = (
    build: (
      resolve: (response: WorkflowBridgeResponse) => void,
    ) => WorkflowBridgeRequest,
  ) =>
    new Promise<WorkflowBridgeResponse>((resolve) => {
      let settled = false;
      const finish = (response: WorkflowBridgeResponse) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(response);
      };
      const timer = setTimeout(
        () =>
          finish({
            ok: false,
            error: "Subagent bridge unavailable or timed out.",
          }),
        10_000,
      );
      pi.events.emit(SUBAGENT_BRIDGE_CHANNEL, build(finish));
    });

  const startStage = async (
    ctx: ExtensionContext,
    stage: StageName,
    task: string,
    reasoningEffort?: WorkflowReasoningEffort,
  ) => {
    const profile = STAGE_PROFILES[stage];
    setState({
      status: "running",
      activeStage: stage,
      stageAgentId: null,
      taskPreview: preview(task),
      lastEvent: `starting ${stage} · ${profile.harness}/${profile.model}`,
      route: {
        mode: "fleet",
        stage,
        confidence: "high",
        reason: "explicit workflow stage",
        skills: [],
      },
    });
    const response = await bridge((resolve) => ({
      kind: "spawn",
      prompt: buildStagePrompt(stage, task, ctx.cwd),
      title: `${stage} · ${preview(task, 70)}`,
      cwd: ctx.cwd,
      harness: profile.harness,
      stage,
      model: profile.model,
      reasoningEffort: reasoningEffort ?? profile.defaultReasoning,
      parent: {
        parentCwd: ctx.cwd,
        projectTrusted: ctx.isProjectTrusted(),
        inheritedModel: ctx.model
          ? { provider: ctx.model.provider, id: ctx.model.id }
          : undefined,
        inheritedThinkingLevel: pi.getThinkingLevel(),
        modelRegistry: ctx.modelRegistry,
      },
      resolve,
    }));
    if (!response.ok || !response.id) {
      setState({
        status: "blocked",
        lastEvent: response.ok ? "stage did not return an id" : response.error,
      });
      throw new Error(
        response.ok ? "Stage did not return an id." : response.error,
      );
    }
    setState({
      stageAgentId: response.id,
      agentIds: [...new Set([...state.agentIds, response.id])],
      lastEvent: `running ${stage}`,
    });
    return response;
  };

  const sendToStage = async (id: string, text: string) => {
    if (state.stageAgentId !== id)
      throw new Error("workflow send requires the active workflow stage id.");
    const response = await bridge((resolve) => ({
      kind: "send",
      id,
      text,
      resolve,
    }));
    if (!response.ok) throw new Error(response.error);
    setState({ status: "running", lastEvent: `sent response to ${id}` });
    return response;
  };

  const handleEnvelope = async (envelope: ControlEnvelope) => {
    const key = JSON.stringify(envelope);
    if (key === lastEnvelope) return;
    lastEnvelope = key;
    if (envelope.kind === "question_batch") {
      const count = envelope.questions.length;
      setState({
        status: "needs-input",
        activeStage: envelope.stage,
        lastEvent: `${count} decision${count === 1 ? "" : "s"} awaiting orchestrator relay`,
      });
      context?.ui.notify(`${envelope.stage} awaits orchestrator relay`, "info");
      void notifyNative(
        `${envelope.stage} awaiting relay`,
        "A workflow decision is waiting for the orchestrator.",
        process.platform,
        pi.exec,
      );
      return;
    }
    if (envelope.kind === "helper_request") {
      setState({
        status: "needs-helper",
        activeStage: envelope.stage,
        lastEvent: `${envelope.role} help requested`,
      });
      context?.ui.notify(
        `${envelope.stage} requests ${envelope.role} help. Sol can broker it from the result card.`,
        "info",
      );
      return;
    }
    if (envelope.kind === "blocked") {
      setState({
        status: "blocked",
        activeStage: envelope.stage,
        lastEvent: envelope.reason,
      });
      context?.ui.notify(
        `${envelope.stage} blocked: ${envelope.reason}`,
        "warning",
      );
      void notifyNative(
        `${envelope.stage} blocked`,
        envelope.reason,
        process.platform,
        pi.exec,
      );
      return;
    }
    setState({
      status: envelope.next ? "running" : "complete",
      activeStage: envelope.next ?? envelope.stage,
      lastEvent: envelope.summary,
    });
    context?.ui.notify(
      `${envelope.stage} complete${envelope.next ? ` · next ${envelope.next}` : ""}`,
      "info",
    );
    void notifyNative(
      `${envelope.stage} complete`,
      envelope.summary,
      process.platform,
      pi.exec,
    );
  };

  const capabilitySnapshot = (ctx: ExtensionContext) => {
    const reader = ctx as ExtensionContext & {
      getSystemPromptOptions?: () => {
        skills?: Array<{ name: string }>;
        selectedTools?: string[];
      };
    };
    const options = reader.getSystemPromptOptions?.();
    return {
      loaded: options?.skills?.map((skill) => skill.name) ?? [],
      selected: options?.selectedTools ?? pi.getActiveTools(),
    };
  };

  const openFlow = async (ctx: ExtensionContext) => {
    if (ctx.mode !== "tui") {
      ctx.ui.notify("/flow requires interactive Pi.", "error");
      return;
    }
    await ctx.ui.custom<void>(
      (tui, _theme, _keybindings, done) => {
        const panel = new FlowPanel(
          { ...ctx, getAgentsUpdatedAt: () => agentsUpdatedAt },
          _theme,
          () => state,
          () => agents,
          () => [...usedCapabilities],
          () => capabilitySnapshot(ctx),
          () => done(),
          () => tui.requestRender(),
        );
        requestRender = () => tui.requestRender();
        return panel;
      },
      {
        overlay: true,
        overlayOptions: {
          anchor: "center",
          width: "88%",
          maxHeight: "84%",
          margin: 1,
        },
      },
    );
    requestRender = undefined;
  };

  pi.registerCommand("flow", {
    description: "Open Vraj workflow control center",
    handler: async (_args, ctx) => openFlow(ctx),
  });
  pi.registerShortcut("f6", {
    description: "Open Vraj workflow control center",
    handler: openFlow,
  });

  pi.registerTool({
    name: "workflow",
    label: "Workflow Control",
    description:
      "Route work, start a pinned planner/coder/debugger/reviewer stage, relay a response to a stage, or inspect workflow state.",
    promptSnippet:
      "Route tasks and control Vraj's planner → coder → debugger → reviewer workflow",
    promptGuidelines: [
      "Use workflow action route before choosing a direct path or fleet stage when the task is ambiguous.",
      "Use workflow action start to launch an explicit stage; it runs the pinned model and returns evidence through the session.",
      "When a stage returns a helper_request, use subagent_spawn as the coordinator, then send the helper result back with workflow action send.",
      "Do not claim a stage is complete from a prose summary; require its machine-checkable evidence.",
    ],
    parameters: Type.Object({
      action: StringEnum([
        "route",
        "start",
        "send",
        "status",
        "recover",
      ] as const),
      prompt: Type.Optional(Type.String()),
      stage: Type.Optional(StringEnum(STAGE_NAMES)),
      reasoning_effort: Type.Optional(StringEnum(REASONING_LEVELS)),
      id: Type.Optional(Type.String()),
      text: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const input: FlowInput = params;
      usedCapabilities.add("workflow");
      pi.events.emit(CAPABILITY_CHANNEL, "workflow");
      if (input.action === "route") {
        const decision = classifyRequest(input.prompt ?? "");
        setState({
          status: "routing",
          route: decision,
          taskPreview: preview(input.prompt ?? ""),
          lastEvent: decision.reason,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(decision, null, 2) }],
          details: decision,
        };
      }
      if (input.action === "recover") {
        return {
          content: [{ type: "text", text: JSON.stringify(state, null, 2) }],
          details: state,
        };
      }
      if (input.action === "status") {
        const response = await bridge((resolve) => ({ kind: "list", resolve }));
        if (!response.ok) throw new Error(response.error);
        if (response.summaries) agents = response.summaries;
        return {
          content: [
            { type: "text", text: JSON.stringify({ state, agents }, null, 2) },
          ],
          details: { state, agents },
        };
      }
      if (input.action === "send") {
        if (!input.id || !input.text?.trim())
          throw new Error("workflow send requires id and text.");
        const response = await sendToStage(input.id, input.text);
        return {
          content: [{ type: "text", text: `Sent response to ${input.id}.` }],
          details: response,
        };
      }
      if (!input.prompt) throw new Error("workflow start requires prompt.");
      const decision = classifyRequest(input.prompt);
      const stage = input.stage ?? decision.stage ?? "planner";
      const response = await startStage(
        ctx,
        stage,
        input.prompt,
        input.reasoning_effort,
      );
      return {
        content: [
          {
            type: "text",
            text: `Started ${stage} as ${response.id}. The result will return to the coordinator.`,
          },
        ],
        details: { stage, id: response.id, model: STAGE_PROFILES[stage].model },
        terminate: true,
      };
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    context = ctx;
    usedCapabilities.clear();
    try {
      const saved = JSON.parse(
        await readFile(statePath(ctx.cwd), "utf8"),
      ) as WorkflowState;
      if (
        ["running", "needs-input", "needs-helper", "blocked"].includes(
          saved.status,
        )
      ) {
        state = {
          ...emptyWorkflowState(),
          ...saved,
          stageAgentId: saved.stageAgentId ?? null,
          status: "recoverable",
          lastEvent: "previous run found; verify evidence before resuming",
        };
      }
    } catch {
      state = emptyWorkflowState();
    }
    publish();
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (ctx.mode !== "tui") return;
    const decision =
      state.activeStage && isControlResponse(event.prompt)
        ? (state.route ?? classifyRequest(event.prompt))
        : classifyRequest(event.prompt);
    setState({
      status:
        state.activeStage && isControlResponse(event.prompt)
          ? state.status
          : "routing",
      route: decision,
      taskPreview: preview(event.prompt),
      lastEvent: `route · ${decision.mode}${decision.stage ? `/${decision.stage}` : ""}`,
    });
    // Human messages always go to the orchestrator; the stable assembly prefix
    // retains this workflow rule while route data stays in the volatile suffix.
    return {
      systemPrompt: assembleWorkflowSystemPrompt({
        baseSystemPrompt: event.systemPrompt,
        route: decision,
      }).systemPrompt,
    };
  });

  pi.on("agent_settled", () => {
    if (!state.activeStage)
      setState({ status: "idle", lastEvent: "direct turn settled" });
  });

  pi.on("tool_execution_start", (event) => {
    usedCapabilities.add(event.toolName);
    pi.events.emit(CAPABILITY_CHANNEL, event.toolName);
  });

  pi.on("message_end", async (event, ctx) => {
    if (
      event.message.role !== "custom" ||
      event.message.customType !== CONTROL_MESSAGE_TYPE
    )
      return;
    const content =
      typeof event.message.content === "string" ? event.message.content : "";
    const envelope = parseControlEnvelope(content);
    if (envelope) await handleEnvelope(envelope);
    if (ctx.mode === "tui") requestRender?.();
  });

  const stopSubagentState = pi.events.on(SUBAGENT_STATE_CHANNEL, (value) => {
    if (!Array.isArray(value)) return;
    agents = value.filter(isWorkflowSubagentSummary);
    agentsUpdatedAt = Date.now();
    state = {
      ...state,
      agentIds: agents.map((agent) => agent.id),
      updatedAt: Date.now(),
    };
    pi.events.emit(WORKFLOW_STATE_CHANNEL, { ...state });
    requestRender?.();
  });

  pi.on("session_shutdown", () => {
    stopSubagentState();
    requestRender = undefined;
    context = undefined;
  });
}
