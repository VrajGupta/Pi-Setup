import { homedir } from "node:os";
import { relative } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  getCapabilities,
  hyperlink,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
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
  WORKFLOW_STATE_CHANNEL,
  emptyWorkflowState,
  type StageName,
  type WorkflowState,
} from "../shared/workflow-state.ts";

const STAGES: StageName[] = ["part1", "part2", "part3", "part4"];

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

function columns(left: string, right: string, width: number) {
  if (!right) return truncateToWidth(left, width);
  const gap = width - visibleWidth(left) - visibleWidth(right);
  if (gap >= 1) return `${left}${" ".repeat(gap)}${right}`;
  const leftWidth = Math.max(1, Math.floor(width * 0.48));
  const rightWidth = Math.max(1, width - leftWidth - 1);
  return truncateToWidth(
    `${truncateToWidth(left, leftWidth)} ${truncateToWidth(right, rightWidth)}`,
    width,
  );
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
    stage === "part1"
      ? "mdHeading"
      : stage === "part2"
        ? "accent"
        : stage === "part3"
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
          return [truncateToWidth(identity, width)];
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
          const runtime = `${model} · ${modelInfo.thinking} · ${activityGlyph(activity)} ${workflow.activeStage ?? "direct"}`;
          const route = workflow.route
            ? `${workflow.route.mode}${workflow.route.stage ? `/${workflow.route.stage}` : ""}`
            : "direct";
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
          const lines = [
            columns(
              theme.fg("text", formatDirectory(ctx.cwd)),
              theme.fg("muted", runtime),
              width,
            ),
            columns(
              `${theme.fg("accent", "flow")} ${flow}`,
              theme.fg("muted", `${route} · ${workflow.status}`),
              width,
            ),
            columns(theme.fg("muted", usage), theme.fg("muted", pr), width),
          ];
          const statuses = Array.from(
            footerData.getExtensionStatuses().values(),
          ).flatMap((value) => value.split("\n"));
          lines.push(...statuses.map((line) => truncateToWidth(line, width)));
          return lines;
        },
      };
    });
    ctx.ui.setTitle(titleFor(ctx, workflow, activity));
    pi.events.emit(REFRESH_CHANNEL, undefined);
  };

  pi.on("session_start", (_event, ctx) => {
    modelInfo = emptyModelInfoState();
    gitInfo = emptyGitInfoState();
    workflow = emptyWorkflowState();
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
    stopRefreshListener();
    activeTui = undefined;
    currentContext = undefined;
    if (ctx.mode === "tui") {
      ctx.ui.setHeader(undefined);
      ctx.ui.setFooter(undefined);
    }
  });
}
