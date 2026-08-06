import { homedir } from "node:os";
import { relative } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { getCapabilities, hyperlink } from "@earendil-works/pi-tui";
import {
  GIT_INFO_CHANNEL,
  MODEL_INFO_CHANNEL,
  REFRESH_CHANNEL,
  emptyGitInfoState,
  emptyModelInfoState,
  isGitInfoState,
  isModelInfoState,
  type GitInfoState,
  type ModelInfoState,
} from "../shared/dashboard-state.ts";
import {
  SUBAGENT_STATE_CHANNEL,
  WORKFLOW_STATE_CHANNEL,
  emptyWorkflowState,
  isWorkflowSubagentSummary,
  type StageName,
  type WorkflowState,
  type WorkflowSubagentSummary,
} from "../shared/workflow-state.ts";
import { columns, renderFooter } from "./footer.ts";
import { readStatusWidgetMaxLines as readMaxLinesFromSettings } from "./status-widget-settings.ts";
import {
  normalizeMaxLines,
  renderStatusWidget,
  type StatusWidgetAgent,
  type StatusWidgetContext,
  type StatusWidgetIssueRecord,
  type StatusWidgetRoutineRecord,
  type StatusWidgetSnapshotView,
  type StatusWidgetState,
} from "./status-widget.ts";

const STAGES: StageName[] = ["planner", "coder", "debugger", "reviewer"];

// INV-19: rows reserved for the editor, the footer, and one spare row. The
// surface emits at most `terminalRows - RESERVED_ROWS` lines so it never
// occludes the prompt.
const RESERVED_ROWS = 6;

type Activity = "idle" | "working" | "done" | "error";

function formatTokens(tokens: number) {
  if (tokens < 1_000) return `${tokens}`;
  if (tokens < 1_000_000) return `${Math.round(tokens / 1_000)}k`;
  return `${(tokens / 1_000_000).toFixed(1)}m`;
}

function formatDirectory(cwd: string) {
  const home = homedir();
  if (cwd === home) return "~";
  return cwd.startsWith(`${home}/`) ? `~/${relative(home, cwd)}` : cwd;
}

function isWorkflowState(value: unknown): value is WorkflowState {
  if (!value || typeof value !== "object") return false;
  const state = value as Record<string, unknown>;
  return (
    typeof state.status === "string" && typeof state.updatedAt === "number"
  );
}

function stageLabel(
  stage: StageName,
  activeStage: StageName | null,
  status: WorkflowState["status"],
  theme: ExtensionContext["ui"]["theme"],
) {
  const index = STAGES.indexOf(stage);
  const activeIndex = activeStage ? STAGES.indexOf(activeStage) : -1;
  const color =
    stage === "planner"
      ? "mdHeading"
      : stage === "coder"
        ? "accent"
        : stage === "debugger"
          ? "warning"
          : "success";
  if (stage === activeStage) return theme.fg(color, `◉ ${stage}`);
  if (status === "complete" || (activeIndex >= 0 && index < activeIndex))
    return theme.fg("success", `✓ ${stage}`);
  return theme.fg("dim", `· ${stage}`);
}

function titleFor(
  ctx: ExtensionContext,
  workflow: WorkflowState,
  activity: Activity,
) {
  const glyph =
    activity === "working"
      ? "·"
      : activity === "error"
        ? "×"
        : activity === "done"
          ? "✓"
          : "?";
  const stage = workflow.activeStage ?? "idle";
  return `${glyph} π ${formatDirectory(ctx.cwd)} · ${stage}`;
}

/**
 * Validate a channel value as the widget's snapshot view. Rejects malformed
 * shapes so a bad publish never replaces the previous snapshot (INV-6); the
 * widget additionally isolates malformed individual records at render time.
 */
function asStatusWidgetSnapshotView(
  value: unknown,
): StatusWidgetSnapshotView | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  if (typeof v.capturedAt !== "number" || !Number.isFinite(v.capturedAt))
    return undefined;
  if (v.reason !== undefined && typeof v.reason !== "string") return undefined;
  if (v.records !== undefined && !Array.isArray(v.records)) return undefined;
  const view: StatusWidgetSnapshotView = {
    capturedAt: v.capturedAt,
    records: Array.isArray(v.records)
      ? v.records.filter(
          (r): r is StatusWidgetIssueRecord =>
            r != null && typeof r === "object",
        )
      : [],
    ...(typeof v.reason === "string" ? { reason: v.reason } : {}),
  };
  return view;
}

export interface UiCustomizationOptions {
  /**
   * Resolve `workflow.statusWidget.maxLines` off the render path (PI-37):
   * `0` means unlimited, values clamp to `[8, 200]`, default 40. Defaults to
   * reading the agent settings file once per widget mount; injectable for
   * deterministic tests.
   */
  readonly readStatusWidgetMaxLines?: () => number;
}

export default function uiCustomization(
  pi: ExtensionAPI,
  options: UiCustomizationOptions = {},
) {
  let modelInfo = emptyModelInfoState();
  let gitInfo = emptyGitInfoState();
  let workflow = emptyWorkflowState();
  let agents: WorkflowSubagentSummary[] = [];
  // Epoch ms of the last subagent-state publish; readings are stamped with it
  // so a quiet bus shows rows as stale (~) instead of falsely fresh.
  let agentsAt = 0;
  let activity: Activity = "idle";
  let ticketSnapshot: StatusWidgetSnapshotView | undefined;
  let routinesSnapshot: readonly StatusWidgetRoutineRecord[] | undefined;
  let activeTui: { requestRender(force?: boolean): void } | undefined;
  let currentContext: ExtensionContext | undefined;

  const refresh = () => activeTui?.requestRender();
  const stopModelListener = pi.events.on(MODEL_INFO_CHANNEL, (value) => {
    if (!isModelInfoState(value)) return;
    modelInfo = value;
    refresh();
  });
  const stopGitListener = pi.events.on(GIT_INFO_CHANNEL, (value) => {
    if (!isGitInfoState(value)) return;
    gitInfo = value;
    refresh();
  });
  const stopWorkflowListener = pi.events.on(WORKFLOW_STATE_CHANNEL, (value) => {
    if (!isWorkflowState(value)) return;
    workflow = value;
    if (currentContext)
      currentContext.ui.setTitle(titleFor(currentContext, workflow, activity));
    refresh();
  });
  const stopSubagentListener = pi.events.on(SUBAGENT_STATE_CHANNEL, (value) => {
    if (!Array.isArray(value)) return;
    agents = value.filter(isWorkflowSubagentSummary);
    agentsAt = Date.now();
    refresh();
  });
  const stopRefreshListener = pi.events.on(REFRESH_CHANNEL, refresh);
  // Routines snapshot (PI-31/32): the workflow extension emits an off-render,
  // read-only summary; the widget only renders it (INV-10, INV-3).
  const ROUTINES_SNAPSHOT_CHANNEL = "vraj:routines-snapshot";
  const stopRoutinesListener = pi.events.on(
    ROUTINES_SNAPSHOT_CHANNEL,
    (value) => {
      const records = Array.isArray(value)
        ? value.filter(
            (r): r is StatusWidgetRoutineRecord =>
              r != null && typeof r === "object",
          )
        : undefined;
      routinesSnapshot = records;
      refresh();
    },
  );
  // Ticket snapshot (PI-36): the workflow extension emits each completed
  // off-render tracker poll read; the widget only renders it (INV-10, INV-3).
  const TICKET_SNAPSHOT_CHANNEL = "vraj:ticket-snapshot";
  const stopTicketListener = pi.events.on(TICKET_SNAPSHOT_CHANNEL, (value) => {
    const view = asStatusWidgetSnapshotView(value);
    if (view === undefined) return;
    ticketSnapshot = view;
    refresh();
  });

  const resolveMaxLines =
    options.readStatusWidgetMaxLines ?? readMaxLinesFromSettings;

  const install = (ctx: ExtensionContext) => {
    if (ctx.mode !== "tui") return;
    currentContext = ctx;
    ctx.ui.setHeader((tui, theme) => {
      activeTui = tui;
      return {
        render(width: number) {
          const identity =
            theme.fg("accent", "π") +
            theme.fg("text", ` ${formatDirectory(ctx.cwd)}`);
          return [columns(identity, "", width)];
        },
        invalidate() {},
      };
    });

    ctx.ui.setFooter((tui, theme, footerData) => {
      activeTui = tui;
      return {
        invalidate() {},
        render(width: number) {
          const model = modelInfo.provider
            ? `${modelInfo.provider}/${modelInfo.modelId}`
            : modelInfo.modelId;
          const runtime = `${model} · ${modelInfo.thinking}`;
          const flow = STAGES.map((stage) =>
            stageLabel(stage, workflow.activeStage, workflow.status, theme),
          ).join(theme.fg("dim", "  →  "));
          const context =
            modelInfo.contextPercent === null
              ? "?"
              : `${Math.round(modelInfo.contextPercent)}%`;
          const contextWindow = modelInfo.contextWindow
            ? formatTokens(modelInfo.contextWindow)
            : "?";
          const tps =
            modelInfo.tokensPerSecond === null
              ? "— tok/s"
              : `${Math.round(modelInfo.tokensPerSecond)} tok/s`;
          const usage = `${context}/${contextWindow} · $${modelInfo.cost.toFixed(2)} · ${tps}`;
          const git = gitInfo.branch
            ? `${gitInfo.branch} · ${gitInfo.changedFiles} changed`
            : "no git";
          const pr =
            gitInfo.pullRequest && getCapabilities().hyperlinks
              ? hyperlink(
                  `PR #${gitInfo.pullRequest.number}`,
                  gitInfo.pullRequest.url,
                )
              : gitInfo.pullRequest
                ? `PR #${gitInfo.pullRequest.number}`
                : git;
          let statuses: string[] = [];
          try {
            statuses = Array.from(footerData.getExtensionStatuses().values());
          } catch {
            // INV-6: a broken extension-status getter degrades the footer to
            // the base lines rather than rendering partial statuses.
            return renderFooter({
              width,
              theme,
              cwdLabel: formatDirectory(ctx.cwd),
              runtime,
              rail: `${theme.fg("accent", "flow")} ${flow}`,
              usage,
              pr,
              statuses: [],
            });
          }
          return renderFooter({
            width,
            theme,
            cwdLabel: formatDirectory(ctx.cwd),
            runtime,
            rail: `${theme.fg("accent", "flow")} ${flow}`,
            usage,
            pr,
            statuses,
          });
        },
      };
    });

    // Register the belowEditor status widget (PI-20, enriched by PI-21).
    ctx.ui.setWidget?.(
      "vraj-status",
      (tui, _theme) => {
        // Settings read happens here, once per widget mount — never inside
        // render (INV-3, PI-37). A throwing resolver degrades to the default.
        let maxLines: number;
        try {
          maxLines = resolveMaxLines();
        } catch {
          maxLines = normalizeMaxLines(undefined);
        }
        // Terminal height is captured here, once per widget mount — never
        // inside render (INV-3, INV-19). A throwing/missing read degrades in
        // render to the maxLines behaviour alone (INV-6).
        let terminalRows: number | undefined;
        try {
          terminalRows = tui.terminal.rows;
        } catch {
          terminalRows = undefined;
        }
        return {
          render(width: number) {
            const now = Date.now();
            const stageAgents: StatusWidgetAgent[] = [];
            for (const agent of agents) {
              if (
                !agent.stage ||
                !(STAGES as readonly string[]).includes(agent.stage)
              )
                continue;
              const context: StatusWidgetContext =
                typeof agent.contextTokens === "number" &&
                Number.isFinite(agent.contextTokens) &&
                agent.contextTokens > 0 &&
                typeof agent.contextWindow === "number" &&
                Number.isFinite(agent.contextWindow) &&
                agent.contextWindow > 0
                  ? {
                      kind: "measured" as const,
                      percent:
                        (agent.contextTokens / agent.contextWindow) * 100,
                    }
                  : { kind: "unknown" as const };
              stageAgents.push({
                stage: agent.stage,
                status: agent.status,
                backend: agent.backend,
                model: agent.modelLabel ?? "?",
                startedAt: agent.startedAt,
                at: agentsAt,
                turns: agent.turns,
                context,
              });
            }
            return renderStatusWidget({
              width,
              maxLines,
              terminalRows,
              reservedRows: RESERVED_ROWS,
              inputLines: [],
              mode: workflow.mode,
              route: workflow.route,
              activeStage: workflow.activeStage,
              workflowStatus: workflow.status,
              now,
              agents: stageAgents,
              ticketSnapshot,
              routines: routinesSnapshot,
            });
          },
          invalidate() {},
        };
      },
      { placement: "belowEditor" },
    );

    ctx.ui.setTitle(titleFor(ctx, workflow, activity));
    pi.events.emit(REFRESH_CHANNEL, undefined);
  };

  pi.on("session_start", (_event, ctx) => {
    modelInfo = emptyModelInfoState();
    gitInfo = emptyGitInfoState();
    workflow = emptyWorkflowState();
    agents = [];
    agentsAt = 0;
    activity = "idle";
    ticketSnapshot = undefined;
    install(ctx);
  });
  pi.on("agent_start", (_event, ctx) => {
    activity = "working";
    ctx.ui.setTitle(titleFor(ctx, workflow, activity));
    refresh();
  });
  pi.on("agent_settled", (_event, ctx) => {
    activity = "done";
    ctx.ui.setTitle(titleFor(ctx, workflow, activity));
    refresh();
  });
  pi.on("agent_end", (event, ctx) => {
    if (
      event.messages.some(
        (message) =>
          message.role === "assistant" && message.stopReason === "error",
      )
    )
      activity = "error";
    ctx.ui.setTitle(titleFor(ctx, workflow, activity));
  });
  pi.on("session_shutdown", (_event, ctx) => {
    stopModelListener();
    stopGitListener();
    stopWorkflowListener();
    stopSubagentListener();
    stopRefreshListener();
    stopRoutinesListener();
    stopTicketListener();
    routinesSnapshot = undefined;
    ticketSnapshot = undefined;
    activeTui = undefined;
    currentContext = undefined;
    if (ctx.mode === "tui") {
      ctx.ui.setHeader(undefined);
      ctx.ui.setFooter(undefined);
      ctx.ui.setWidget?.("vraj-status", undefined);
    }
  });
}
