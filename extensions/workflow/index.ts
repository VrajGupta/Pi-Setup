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
import {
  parseTicketSnapshot,
  TICKET_STATUSES,
  type TicketRecord,
  type TicketSnapshot,
  type TicketStatus,
} from "../shared/ticket-snapshot.ts";
import { notifyNative } from "../shared/notify-native.ts";
import {
  STAGE_PROFILES,
  buildStagePrompt,
  classifyRequest,
  parseControlEnvelope,
  type ControlEnvelope,
  type RouteDecision,
  type WorkflowMode,
} from "./src/policy.ts";
import {
  readRoutines,
  writeRoutines,
  type RoutineDefinition,
} from "./routines-settings.ts";
import { assembleWorkflowSystemPrompt } from "./prompt-assembly.ts";
import { persistWorkflowMode, validateWorkflowMode } from "./settings-mode.ts";

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

/** One declared repository root plus the result of reading its tracker. */
export interface RepositoryRead {
  readonly path: string;
  readonly repo: string;
  readonly capturedAt: number;
  readonly snapshot?: TicketSnapshot;
  readonly reason?: string;
}

/** Cross-repository view input: reads plus whether the registry was defaulted. */
export interface RepositoryView {
  readonly defaulted: boolean;
  readonly reads: readonly RepositoryRead[];
}

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
const SECRET_ASSIGNMENT_PATTERN =
  /(["']?(?:api[_-]?key|access[_-]?key|access[_-]?token|aws[_-]?access[_-]?key[_-]?id|authorization|cookie|credential|key|password|passwd|private[_-]?key|secret|token|[a-z][a-z0-9_-]*[_-](?:key|token|secret|password|passwd|credential|url|uri)(?:[_-][a-z0-9]+)?)["']?\s*[:=]\s*)(?:"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|["'][^\r\n]*|[^\s,;}]+)/gi;
const URI_PATTERN = /\b[a-z][a-z0-9+.-]*:\/{1,2}[^\s]+/gi;
const ROOTLESS_CREDENTIAL_URI_PATTERN =
  /\b[a-z][a-z0-9+.-]*:[^/\s:@]+:[^@\s]+@[^\s]+/gi;

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
    .replace(SECRET_ASSIGNMENT_PATTERN, "$1[REDACTED]")
    .replace(
      /([?&](?:api[_-]?key|access[_-]?token|key|secret|token)=)[^&#\s]+/gi,
      "$1[REDACTED]",
    )
    .replace(ROOTLESS_CREDENTIAL_URI_PATTERN, "[URL]")
    .replace(URI_PATTERN, "[URL]");
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

function isTicketStatus(value: unknown): value is TicketStatus {
  return (
    typeof value === "string" && TICKET_STATUSES.includes(value as TicketStatus)
  );
}

function isTicketRecord(value: unknown): value is TicketRecord {
  if (!isRecord(value)) return false;
  if (
    typeof value.repo !== "string" ||
    typeof value.id !== "string" ||
    typeof value.title !== "string" ||
    !isTicketStatus(value.status) ||
    !Array.isArray(value.blockedBy) ||
    (value.assignee !== undefined &&
      !["planner", "coder", "debugger", "reviewer"].includes(
        value.assignee as string,
      )) ||
    !["unblocked", "blocked", "blocked (cycle)"].includes(
      value.blocking as string,
    ) ||
    !isRecord(value.eta)
  ) {
    return false;
  }
  const blockerIds = new Set<string>();
  if (
    !value.blockedBy.every(
      (blocker) =>
        isRecord(blocker) &&
        typeof blocker.id === "string" &&
        blocker.id.trim().length > 0 &&
        !blockerIds.has(blocker.id) &&
        blockerIds.add(blocker.id) &&
        typeof blocker.satisfied === "boolean",
    )
  ) {
    return false;
  }
  const hasUnsatisfiedBlocker = value.blockedBy.some(
    (blocker) => isRecord(blocker) && blocker.satisfied === false,
  );
  if (
    (value.blocking === "unblocked" && hasUnsatisfiedBlocker) ||
    (value.blocking === "blocked" && !hasUnsatisfiedBlocker)
  ) {
    return false;
  }
  if (value.eta.kind === "unknown") return true;
  const minMs = finiteNumber(value.eta.minMs);
  const maxMs = finiteNumber(value.eta.maxMs);
  const n = finiteNumber(value.eta.n);
  return (
    value.eta.kind === "estimated" &&
    minMs !== undefined &&
    Number.isSafeInteger(minMs) &&
    minMs > 0 &&
    maxMs !== undefined &&
    Number.isSafeInteger(maxMs) &&
    maxMs >= minMs &&
    n !== undefined &&
    Number.isSafeInteger(n) &&
    n >= 3
  );
}

function isTicketSnapshot(value: unknown): value is TicketSnapshot {
  if (
    !isRecord(value) ||
    typeof value.repo !== "string" ||
    finiteNumber(value.capturedAt) === undefined ||
    !Array.isArray(value.records) ||
    (value.reason !== undefined && typeof value.reason !== "string")
  ) {
    return false;
  }
  const ids = new Set<string>();
  for (const record of value.records) {
    if (
      !isTicketRecord(record) ||
      record.repo !== value.repo ||
      ids.has(record.id)
    )
      return false;
    ids.add(record.id);
  }
  return true;
}

function issueField(value: unknown) {
  return displayText(value).trim() || "—";
}

function issueStatus(status: TicketStatus) {
  switch (status) {
    case "agent-ready":
      return "ready";
    case "coding":
    case "debugger-ready":
    case "debugging":
    case "review-ready":
      return `active: ${status}`;
    case "canceled":
    case "duplicate":
      return `dropped: ${status}`;
    default:
      return status;
  }
}

function issueBlockers(record: TicketRecord) {
  const blockers = record.blockedBy.length
    ? record.blockedBy
        .map(
          (blocker) =>
            `${issueField(blocker.id)} (${blocker.satisfied ? "satisfied" : "blocked"})`,
        )
        .join(", ")
    : "none";
  return `blockers ${blockers} · chain ${record.blocking === "unblocked" ? "satisfied" : "blocked"}`;
}

function issueEta(record: TicketRecord) {
  return record.eta.kind === "unknown"
    ? "eta unknown"
    : `eta ${record.eta.minMs}–${record.eta.maxMs}ms (n=${record.eta.n})`;
}

function issueRow(record: TicketRecord) {
  return ` repo ${issueField(record.repo)} · id ${issueField(record.id)} · title ${issueField(record.title)} · assignee ${record.assignee ?? "—"} · status ${issueStatus(record.status)} · ${issueBlockers(record)} · ${issueEta(record)}`;
}

function repositoryHeader(read: RepositoryRead, now: number) {
  if (read.snapshot === undefined || read.snapshot.reason !== undefined) {
    return ` repo ${issueField(read.repo)} — unavailable — ${issueField(read.reason || read.snapshot?.reason || "unknown")}`;
  }
  const capturedAt = Math.min(read.capturedAt, read.snapshot.capturedAt);
  const age = Math.max(0, now - capturedAt);
  const count = read.snapshot.records.length;
  const stale = age > REPOSITORY_STALENESS_MS;
  return ` repo ${issueField(read.repo)} · ${count} ticket${count === 1 ? "" : "s"}${stale ? ` · ~ ${formatElapsed(age)}` : ""}`;
}

function repositoryRows(read: RepositoryRead) {
  return read.snapshot === undefined || read.snapshot.reason !== undefined
    ? []
    : read.snapshot.records.map(issueRow);
}

function repositoryList(
  defaulted: boolean,
  reads: readonly RepositoryRead[],
  sections: readonly (readonly string[])[],
  now: number,
) {
  const lines = [" issues / todos"];
  if (defaulted) lines.push(" registry default: this repository only");
  reads.forEach((read, index) => {
    lines.push(repositoryHeader(read, now));
    lines.push(...(sections[index] ?? []));
  });
  return lines;
}

function isRepositoryRead(value: unknown): value is RepositoryRead {
  if (
    !isRecord(value) ||
    typeof value.path !== "string" ||
    typeof value.repo !== "string" ||
    finiteNumber(value.capturedAt) === undefined
  ) {
    return false;
  }
  const hasSnapshot = value.snapshot !== undefined;
  const hasReason = value.reason !== undefined;
  if (hasSnapshot === hasReason) return false;
  if (hasReason && typeof value.reason !== "string") return false;
  return (
    !hasSnapshot ||
    (isTicketSnapshot(value.snapshot) && value.snapshot.repo === value.repo)
  );
}

function normalizeRepositoryRead(value: unknown): RepositoryRead {
  if (isRepositoryRead(value)) return value;
  const fallback = isRecord(value) ? value : {};
  return {
    path: typeof fallback.path === "string" ? fallback.path : "",
    repo: typeof fallback.repo === "string" ? fallback.repo : "?",
    capturedAt: finiteNumber(fallback.capturedAt) ?? 0,
    reason: "invalid snapshot",
  };
}

// The registry is declared in settings only; there is deliberately no
// directory scan, glob, or auto-discovery of repositories here.
export function resolveRepositories(
  settings: unknown,
  fallback: string,
): { readonly defaulted: boolean; readonly paths: readonly string[] } {
  const workflow = isRecord(settings) ? settings.workflow : undefined;
  const raw = isRecord(workflow) ? workflow.repositories : undefined;
  if (
    Array.isArray(raw) &&
    raw.length > 0 &&
    raw.every((entry) => typeof entry === "string" && entry.trim().length > 0)
  ) {
    return {
      defaulted: false,
      paths: [
        ...new Set(
          raw.map((entry) => {
            const path = entry.trim();
            if (path === "~") return homedir();
            if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
            return resolve(fallback, path);
          }),
        ),
      ],
    };
  }
  return { defaulted: true, paths: [fallback] };
}

const REPOSITORY_READ_TIMEOUT = Symbol("repository read timed out");
const REPOSITORY_STALENESS_MS = 30_000;

export interface RepositoryReadOptions {
  readonly readTracker?: (path: string) => Promise<string>;
  readonly timeoutMs?: number;
  readonly now?: () => number;
}

/** Bounded, read-only tracker read for one declared repository (off render). */
export async function readRepositoryTracker(
  declaredPath: string,
  options: RepositoryReadOptions = {},
): Promise<RepositoryRead> {
  const readTracker =
    options.readTracker ?? ((path: string) => readFile(path, "utf8"));
  const requestedTimeout = finiteNumber(options.timeoutMs);
  const timeoutMs =
    requestedTimeout === undefined || requestedTimeout <= 0
      ? 2_000
      : Math.min(requestedTimeout, 2_000);
  const now = options.now ?? Date.now;
  const path =
    declaredPath === "~"
      ? homedir()
      : declaredPath.startsWith("~/")
        ? resolve(homedir(), declaredPath.slice(2))
        : resolve(declaredPath);
  const base = {
    path,
    repo: basename(path),
    capturedAt: finiteNumber(now()) ?? Date.now(),
  };
  let tracker: string;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    tracker = await Promise.race([
      Promise.resolve().then(() => readTracker(join(path, "tickets.md"))),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(REPOSITORY_READ_TIMEOUT), timeoutMs);
      }),
    ]);
  } catch (error) {
    if (error === REPOSITORY_READ_TIMEOUT)
      return { ...base, reason: "timeout" };
    if (isRecord(error) && error.code === "ENOENT")
      return { ...base, reason: "no tracker" };
    return { ...base, reason: "unreadable" };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  try {
    const snapshot = parseTicketSnapshot(tracker, {
      repo: base.repo,
      capturedAt: base.capturedAt,
    });
    if (snapshot.reason !== undefined)
      return { ...base, reason: snapshot.reason };
    return { ...base, snapshot };
  } catch {
    return { ...base, reason: "unreadable" };
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
    "Issues",
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
  private readonly getTicketSnapshot: () => unknown;
  private readonly getRepositoryView: () => RepositoryView | undefined;
  private cachedReads: readonly RepositoryRead[] | undefined;
  private cachedNormalizedReads: readonly RepositoryRead[] | undefined;
  private cachedSections: readonly string[][] | undefined;

  constructor(
    ctx: FlowPanelContext,
    theme: FlowPanelTheme,
    getState: () => WorkflowState,
    getAgents: () => WorkflowSubagentSummary[],
    getUsed: () => string[],
    getCapabilities: () => { loaded: string[]; selected: string[] },
    done: () => void,
    rerender: () => void,
    getTicketSnapshot: () => unknown = () => undefined,
    getRepositoryView: () => RepositoryView | undefined = () => undefined,
  ) {
    this.ctx = ctx;
    this.theme = theme;
    this.getState = getState;
    this.getAgents = getAgents;
    this.getUsed = getUsed;
    this.getCapabilities = getCapabilities;
    this.done = done;
    this.rerender = rerender;
    this.getTicketSnapshot = getTicketSnapshot;
    this.getRepositoryView = getRepositoryView;
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
      case 5:
        return this.issues(now);
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
      ` mode: ${state.mode === "free" ? "free" : "workflow"}`,
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

  private issues(now: number) {
    try {
      const view = this.readRepositoryView();
      if (view === "invalid") {
        this.clearIssueCache();
        return [" issue list unavailable — invalid snapshot"];
      }
      if (view === undefined) {
        this.clearIssueCache();
        return [" issue list unavailable — snapshot unavailable"];
      }
      if (view.reads.length === 0) {
        this.clearIssueCache();
        return [" issue list unavailable — no repositories registered"];
      }
      if (
        view.reads !== this.cachedReads ||
        this.cachedSections === undefined
      ) {
        this.cachedReads = view.reads;
        this.cachedNormalizedReads = view.reads.map(normalizeRepositoryRead);
        this.cachedSections = this.cachedNormalizedReads.map(repositoryRows);
      }
      return repositoryList(
        view.defaulted,
        this.cachedNormalizedReads ?? [],
        this.cachedSections ?? [],
        now,
      );
    } catch {
      this.clearIssueCache();
      return [" issue list unavailable — snapshot unavailable"];
    }
  }

  private clearIssueCache() {
    this.cachedReads = undefined;
    this.cachedNormalizedReads = undefined;
    this.cachedSections = undefined;
  }

  private readRepositoryView(): RepositoryView | "invalid" | undefined {
    const view = this.getRepositoryView();
    if (view !== undefined) {
      if (
        !isRecord(view) ||
        typeof view.defaulted !== "boolean" ||
        !Array.isArray(view.reads)
      )
        return "invalid";
      return { defaulted: view.defaulted, reads: view.reads };
    }
    const snapshot = this.getTicketSnapshot();
    if (snapshot === undefined) return undefined;
    if (!isTicketSnapshot(snapshot)) return "invalid";
    return {
      defaulted: false,
      reads: [
        {
          path: this.ctx.cwd,
          repo: snapshot.repo,
          capturedAt: snapshot.capturedAt,
          snapshot,
        },
      ],
    };
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

export type ModeCommandOutcome =
  | { kind: "pick" }
  | { kind: "switch"; mode: WorkflowMode; confirmation: string }
  | { kind: "warn"; message: string };

/** Pure function: given a raw /mode arg string, return the intended outcome. */
export function normalizeModeCommand(value: string): ModeCommandOutcome {
  const trimmed = value.trim();
  const lowered = trimmed.toLowerCase();
  if (!trimmed) return { kind: "pick" };
  if (lowered !== "workflow" && lowered !== "free") {
    return {
      kind: "warn",
      message: `unknown mode "${trimmed}" — use workflow or free`,
    };
  }
  return {
    kind: "switch",
    mode: lowered as WorkflowMode,
    confirmation: lowered === "free" ? "mode free (manual)" : "mode workflow",
  };
}

export const MODE_COMPLETIONS = [
  { value: "workflow", label: "workflow" },
  { value: "free", label: "free" },
];

export type RoutineCommandOutcome =
  | { kind: "pick" }
  | { kind: "run"; name: string }
  | { kind: "snooze"; name: string; minutes: number }
  | { kind: "disable"; name: string }
  | { kind: "enable"; name: string }
  | { kind: "warn"; message: string };

const DEFAULT_SNOOZE_MINUTES = 60;
const MAX_SNOOZE_MINUTES = 10080;

/** Parse a snooze minutes argument; absent defaults to 60, out-of-range clamps. */
function parseSnoozeMinutes(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return DEFAULT_SNOOZE_MINUTES;
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return null;
  return Math.min(MAX_SNOOZE_MINUTES, n);
}

/** Quiet due-routine banner (q3). Terminal-safe; never auto-runs (INV-8). */
export function routineBanner(name: string): string {
  const safe = displayText(name).trim() || "?";
  return `routine ${safe} due — /routine run ${safe} · /routine snooze ${safe} [min] · /routine disable ${safe} · dismiss`;
}

/** Parse a raw `/routine` argument string into a command outcome. */
export function normalizeRoutineCommand(value: string): RoutineCommandOutcome {
  const trimmed = value.trim();
  if (!trimmed) return { kind: "pick" };
  const parts = trimmed.split(/\s+/);
  const [sub, rest, extra] = parts;
  const lowered = sub.toLowerCase();
  if (lowered === "run") {
    if (!rest || !rest.trim())
      return { kind: "warn", message: "usage: /routine run <name>" };
    return { kind: "run", name: rest };
  }
  if (lowered === "snooze") {
    if (!rest || !rest.trim())
      return {
        kind: "warn",
        message: "usage: /routine snooze <name> [minutes]",
      };
    const minutes = parseSnoozeMinutes(extra);
    if (minutes === null)
      return {
        kind: "warn",
        message: `invalid minutes "${extra}" — use a whole number from 1 to 10080`,
      };
    return { kind: "snooze", name: rest, minutes };
  }
  if (lowered === "disable") {
    if (!rest || !rest.trim())
      return { kind: "warn", message: "usage: /routine disable <name>" };
    return { kind: "disable", name: rest };
  }
  if (lowered === "enable") {
    if (!rest || !rest.trim())
      return { kind: "warn", message: "usage: /routine enable <name>" };
    return { kind: "enable", name: rest };
  }
  return {
    kind: "warn",
    message: `unknown routine "${sub}" — use /flow to list routines`,
  };
}

/** Apply a persisted update (snooze/disable/enable) to one routine by name. */
export function applyRoutineUpdate(
  routines: readonly RoutineDefinition[],
  name: string,
  update: { snoozedUntil?: number; enabled?: boolean },
): { ok: boolean; routines?: readonly RoutineDefinition[] } {
  const index = routines.findIndex((r) => r.name === name);
  if (index < 0) return { ok: false };
  const next = routines.map((r, i) => (i === index ? { ...r, ...update } : r));
  return { ok: true, routines: next };
}

/** Argument completions for `/routine` mirroring the configured routine names. */
export function routineCompletions(
  routines: readonly RoutineDefinition[],
): { value: string; label: string }[] {
  return routines.map((r) => ({ value: r.name, label: r.name }));
}

/** INV-8: a routine's prompt is classified like any normal user request. */
export function classifyRoutinePrompt(
  prompt: string,
  mode: WorkflowMode,
): RouteDecision {
  return classifyRequest(prompt, mode);
}

/** Persist a full settings object atomically (temp-file + rename, INV-12). */
async function persistSettingsFile(
  settings: Record<string, unknown>,
): Promise<boolean> {
  try {
    const path = join(getAgentDir(), "settings.json");
    const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(
      temporary,
      `${JSON.stringify(settings, null, 2)}\n`,
      "utf8",
    );
    await rename(temporary, path);
    return true;
  } catch {
    return false;
  }
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
  // Live routing mode (PI-19): session-scoped, initialized from the configured
  // default (`workflow.mode` in settings) and changed only by /mode. The switch
  // never classifies, routes, or starts a fleet stage by itself.
  let mode: WorkflowMode = "workflow";
  let context: ExtensionContext | undefined;
  let agents: WorkflowSubagentSummary[] = [];
  let agentsUpdatedAt = Date.now();
  let repositoryView: RepositoryView = { defaulted: true, reads: [] };
  const usedCapabilities = new Set<string>();
  let requestRender: (() => void) | undefined;
  let lastEnvelope = "";
  let configuredRoutines: readonly RoutineDefinition[] = [];

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

  const readGlobalSettings = async (): Promise<unknown> => {
    try {
      return JSON.parse(
        await readFile(join(getAgentDir(), "settings.json"), "utf8"),
      );
    } catch {
      return undefined;
    }
  };

  const refreshRepositoryView = async (ctx: ExtensionContext) => {
    try {
      const settings = await readGlobalSettings();
      const { defaulted, paths } = resolveRepositories(settings, ctx.cwd);
      const reads = await Promise.all(
        paths.map((path) => readRepositoryTracker(path)),
      );
      repositoryView = { defaulted, reads };
    } catch {
      repositoryView = { defaulted: true, reads: [] };
    }
    requestRender?.();
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

  // INV-8: classify only; never spawn or send on the subagent bridge.
  const runRoutine = async (
    routine: RoutineDefinition,
    ctx: ExtensionContext,
  ) => {
    const decision = classifyRoutinePrompt(routine.prompt, mode);
    setState({
      status: "routing",
      route: decision,
      taskPreview: preview(routine.prompt),
      lastEvent: `routine ${routine.name} · ${decision.reason}`,
    });
    ctx.ui.notify(
      `routine ${routine.name} → ${decision.mode}${decision.stage ? `/${decision.stage}` : ""} · ${decision.reason}`,
      "info",
    );
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
          () => undefined,
          () => repositoryView,
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

  pi.registerCommand("mode", {
    description: "Set workflow routing mode (workflow | free)",
    getArgumentCompletions: (prefix: string) => {
      if (!prefix) return MODE_COMPLETIONS;
      const lower = prefix.toLowerCase();
      return MODE_COMPLETIONS.filter((item) => item.value.startsWith(lower));
    },
    handler: async (args, ctx) => {
      const outcome = normalizeModeCommand(
        typeof args === "string" ? args : "",
      );
      if (outcome.kind === "pick") {
        const choice = await ctx.ui.select("Routing mode", [
          "workflow",
          "free",
        ]);
        if (!choice) return;
        const picked = normalizeModeCommand(choice);
        if (picked.kind !== "switch") return;
        mode = picked.mode;
        setState({ mode, lastEvent: `mode: ${picked.mode}` });
        const persisted = await persistWorkflowMode(mode);
        ctx.ui.notify(
          persisted
            ? picked.confirmation
            : `${picked.confirmation} · session only`,
          persisted ? "info" : "warning",
        );
        return;
      }
      if (outcome.kind === "warn") {
        ctx.ui.notify(outcome.message, "warning");
        return;
      }
      mode = outcome.mode;
      setState({ mode, lastEvent: `mode: ${outcome.mode}` });
      const persisted = await persistWorkflowMode(mode);
      ctx.ui.notify(
        persisted
          ? outcome.confirmation
          : `${outcome.confirmation} · session only`,
        persisted ? "info" : "warning",
      );
    },
  });

  pi.registerCommand("routine", {
    description: "Run, snooze, disable, or enable a routine",
    getArgumentCompletions: (prefix: string) => {
      if (!prefix) return routineCompletions(configuredRoutines);
      const lower = prefix.toLowerCase();
      return routineCompletions(configuredRoutines).filter((item) =>
        item.value.toLowerCase().startsWith(lower),
      );
    },
    handler: async (args, ctx) => {
      const outcome = normalizeRoutineCommand(
        typeof args === "string" ? args : "",
      );
      if (outcome.kind === "warn") {
        ctx.ui.notify(outcome.message, "warning");
        return;
      }
      const settings = await readGlobalSettings();
      const base = isRecord(settings) ? settings : {};
      const { routines: raw } = readRoutines(base);
      const routines = [...raw];
      configuredRoutines = routines;
      if (outcome.kind === "pick") {
        const available = routines.filter(
          (r) =>
            r.enabled &&
            (r.snoozedUntil === undefined || r.snoozedUntil <= Date.now()),
        );
        if (available.length === 0) {
          ctx.ui.notify(
            "no routines configured — add workflow.routines to settings.json",
            "info",
          );
          return;
        }
        const choice = await ctx.ui.select(
          "Routine",
          available.map((r) => r.name),
        );
        if (!choice) return;
        const routine = available.find((r) => r.name === choice);
        if (routine) await runRoutine(routine, ctx);
        return;
      }
      if (outcome.kind === "run") {
        const routine = routines.find((r) => r.name === outcome.name);
        if (!routine) {
          ctx.ui.notify(
            `unknown routine "${outcome.name}" — use /flow to list routines`,
            "warning",
          );
          return;
        }
        await runRoutine(routine, ctx);
        return;
      }
      const update =
        outcome.kind === "snooze"
          ? { snoozedUntil: Date.now() + outcome.minutes * 60_000 }
          : outcome.kind === "disable"
            ? { enabled: false }
            : { enabled: true };
      const result = applyRoutineUpdate(routines, outcome.name, update);
      if (!result.ok || result.routines === undefined) {
        ctx.ui.notify(
          `unknown routine "${outcome.name}" — use /flow to list routines`,
          "warning",
        );
        return;
      }
      const merged = writeRoutines([...result.routines], base);
      if (!merged.ok || merged.settings === undefined) {
        ctx.ui.notify("routine change not persisted", "warning");
        return;
      }
      const persisted = await persistSettingsFile(merged.settings);
      configuredRoutines = [...result.routines];
      const label =
        outcome.kind === "snooze"
          ? `snoozed for ${outcome.minutes}m`
          : outcome.kind === "disable"
            ? "disabled"
            : "enabled";
      ctx.ui.notify(
        persisted
          ? `routine ${outcome.name} ${label}`
          : `routine ${outcome.name} ${label} · session only`,
        persisted ? "info" : "warning",
      );
    },
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
        const decision = classifyRequest(input.prompt ?? "", mode);
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
      const decision = classifyRequest(input.prompt, mode);
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
    await refreshRepositoryView(ctx);
    const settings = await readGlobalSettings();
    const workflow = isRecord(settings) ? settings.workflow : undefined;
    const raw = isRecord(workflow) ? workflow.mode : undefined;
    const { mode: m, warning } = validateWorkflowMode(raw);
    mode = m;
    configuredRoutines = readRoutines(
      isRecord(settings) ? settings : {},
    ).routines;
    if (warning) ctx.ui.notify(warning, "warning");
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
    // The live mode is session-scoped: it starts from the configured default
    // every session, never restored from a previous run's persisted state.
    state = { ...state, mode };
    publish();
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (ctx.mode !== "tui") return;
    const decision =
      state.activeStage && isControlResponse(event.prompt)
        ? (state.route ?? classifyRequest(event.prompt, mode))
        : classifyRequest(event.prompt, mode);
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
    repositoryView = { defaulted: true, reads: [] };
  });
}
