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
import { buildReading } from "../shared/stage-progress.ts";
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
import { renderStatusWidget, type StatusWidgetState } from "./status-widget.ts";

const STAGES: StageName[] = ["planner", "coder", "debugger", "reviewer"];

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

function activityGlyph(activity: Activity) {
  if (activity === "working") return "·";
  if (activity === "done") return "✓";
  if (activity === "error") return "×";
  return "○";
}

function stageReason(
  agent: WorkflowSubagentSummary,
  workflow: WorkflowState,
  agentsAt: number,
  now: number,
) {
  const event = workflow.lastEvent;
  if (agent.status === "error") {
    // Only label a provider cause when the event is actually provider-shaped;
    // a generic error must render reason unknown, never a fabricated cause.
    return /\b(provider|authorization|timeout|rate limit|quota|spend|unavailable)\b|\b5\d\d\b/i.test(
      event,
    )
      ? `provider error: ${event}`
      : "reason unknown";
  }
  if (agent.stage === workflow.activeStage) {
    if (workflow.status === "needs-input") return "waiting on question";
    if (workflow.status === "needs-helper") return "waiting on helper";
    if (workflow.status === "blocked") {
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
  if (!Number.isFinite(agentsAt) || now - agentsAt > 30_000)
    return "stale bridge";
  return agent.stage === workflow.activeStage && workflow.status === "running"
    ? "working"
    : "reason unknown";
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

export default function uiCustomization(pi: ExtensionAPI) {
  let modelInfo = emptyModelInfoState();
  let gitInfo = emptyGitInfoState();
  let workflow = emptyWorkflowState();
  let agents: WorkflowSubagentSummary[] = [];
  // Epoch ms of the last subagent-state publish; readings are stamped with it
  // so a quiet bus shows rows as stale (~) instead of falsely fresh.
  let agentsAt = 0;
  let activity: Activity = "idle";
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
          const now = Date.now();
          const model = modelInfo.provider
            ? `${modelInfo.provider}/${modelInfo.modelId}`
            : modelInfo.modelId;
          const runtime = `${model} · ${modelInfo.thinking} · ${activityGlyph(activity)} ${workflow.activeStage ?? "direct"}`;
          const route = workflow.route
            ? `${workflow.route.mode}${workflow.route.stage ? `/${workflow.route.stage}` : ""}`
            : "direct";
          const running = agents.filter(
            (agent) => agent.status === "running",
          ).length;
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
            // the base lines rather than rendering partial agent/status rows.
            return renderFooter({
              width,
              theme,
              now,
              cwdLabel: formatDirectory(ctx.cwd),
              runtime,
              rail: `${theme.fg("accent", "flow")} ${flow}`,
              routeStatus: `${route} · ${workflow.status} · ${running} running · ${agents.length} tracked`,
              usage,
              pr,
              agents: [],
              statuses: [],
              readingFor: () =>
                buildReading({
                  source: "context",
                  done: undefined,
                  total: undefined,
                  at: agentsAt,
                  elapsedMs: now - agentsAt,
                  turns: 0,
                }),
              reasonFor: () => "reason unknown",
            });
          }
          return renderFooter({
            width,
            theme,
            now,
            cwdLabel: formatDirectory(ctx.cwd),
            runtime,
            rail: `${theme.fg("accent", "flow")} ${flow}`,
            routeStatus: `${route} · ${workflow.status} · ${running} running · ${agents.length} tracked`,
            usage,
            pr,
            agents,
            statuses,
            readingFor: (agent) =>
              buildReading({
                source: "context",
                done: agent.contextTokens,
                total: agent.contextWindow,
                at: agentsAt,
                elapsedMs: now - agent.startedAt,
                turns: agent.turns,
              }),
            reasonFor: (agent) => stageReason(agent, workflow, agentsAt, now),
          });
        },
      };
    });

    // Register the belowEditor status widget (PI-20).
    // The widget is initialized with empty input lines for now; later tickets will
    // populate it with mode, route, stage, and issue rows.
    ctx.ui.setWidget?.(
      "vraj-status",
      (_tui, _theme) => {
        return {
          render(width: number) {
            return renderStatusWidget({
              width,
              maxLines: undefined,
              inputLines: [],
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
    activeTui = undefined;
    currentContext = undefined;
    if (ctx.mode === "tui") {
      ctx.ui.setHeader(undefined);
      ctx.ui.setFooter(undefined);
      ctx.ui.setWidget?.("vraj-status", undefined);
    }
  });
}
