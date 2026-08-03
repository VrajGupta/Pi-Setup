import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
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
import {
  STAGE_PROFILES,
  buildStagePrompt,
  classifyRequest,
  parseControlEnvelope,
  type ControlEnvelope,
  type RouteDecision,
} from "./src/policy.ts";

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
const MAX_STAGE_QUESTIONS = 3;

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

function modelLabel(ctx: ExtensionContext) {
  if (!ctx.model) return "no model";
  return `${ctx.model.provider}/${ctx.model.id}`;
}

class FlowPanel {
  private tab = 0;
  private readonly tabs = [
    "Overview",
    "Workflow",
    "Agents",
    "Capabilities",
    "Session",
  ];

  constructor(
    private readonly ctx: ExtensionContext,
    private readonly getState: () => WorkflowState,
    private readonly getAgents: () => WorkflowSubagentSummary[],
    private readonly getUsed: () => string[],
    private readonly getCapabilities: () => {
      loaded: string[];
      selected: string[];
    },
    private readonly done: () => void,
    private readonly rerender: () => void,
  ) {}

  handleInput(data: string) {
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
    const state = this.getState();
    const lines = [
      ` ${this.tabs.map((tab, index) => (index === this.tab ? `[${tab}]` : ` ${tab} `)).join("  ")}`,
      "",
      ...this.content(state),
      "",
      " ←/→ or tab switch · esc close",
    ];
    return lines.map((line) => truncateToWidth(line, width));
  }

  invalidate() {}

  private content(state: WorkflowState) {
    switch (this.tab) {
      case 1:
        return this.workflow(state);
      case 2:
        return this.agents();
      case 3:
        return this.capabilities();
      case 4:
        return this.session(state);
      default:
        return this.overview(state);
    }
  }

  private overview(state: WorkflowState) {
    const usage = this.ctx.getContextUsage();
    const percent =
      typeof usage?.percent === "number"
        ? `${Math.round(usage.percent)}%`
        : "?";
    const window =
      typeof usage?.contextWindow === "number"
        ? formatTokens(usage.contextWindow)
        : "?";
    return [
      " π /flow",
      ` ${this.ctx.cwd}`,
      ` route   ${routeText(state.route)}`,
      ` status  ${state.status}${state.activeStage ? ` · ${state.activeStage}` : ""}`,
      ` model   ${modelLabel(this.ctx)}`,
      ` think   ${this.ctx.thinkingLevel} · context ${percent}/${window}`,
      ` agents  ${this.getAgents().filter((agent) => agent.status === "running").length} running · ${this.getAgents().length} tracked`,
      state.lastEvent ? ` event   ${state.lastEvent}` : "",
    ];
  }

  private workflow(state: WorkflowState) {
    return [
      " workflow rail",
      ` ${rail(state.activeStage, state.status)}`,
      ` task    ${state.taskPreview || "none"}`,
      ` stage   ${state.activeStage ?? "none"}`,
      ` agent   ${state.stageAgentId ?? "none"}`,
      "",
      " Stage models",
      ...STAGE_NAMES.map((stage) => {
        const profile = STAGE_PROFILES[stage];
        return ` ${stage}  ${profile.harness}/${profile.model} · ${profile.defaultReasoning}`;
      }),
    ];
  }

  private agents() {
    const agents = this.getAgents();
    if (agents.length === 0) return [" agents", " none tracked"];
    return [
      " agents",
      ...agents.map(
        (agent) =>
          ` ${statusGlyph(agent.status)} ${agent.id} · ${agent.title} · ${agent.backend}/${agent.modelLabel ?? "?"} · ${agent.turns} turns`,
      ),
    ];
  }

  private capabilities() {
    const capabilities = this.getCapabilities();
    const used = this.getUsed();
    const loaded = capabilities.loaded;
    const selected = capabilities.selected;
    return [
      " capabilities",
      ` loaded skills    ${loaded.join(", ") || "none"}`,
      ` selected tools   ${selected.join(", ") || "none"}`,
      ` invoked this run ${used.join(", ") || "none"}`,
    ];
  }

  private session(state: WorkflowState) {
    const file = this.ctx.sessionManager.getSessionFile();
    return [
      " session",
      ` file    ${file ? relative(homedir(), file) : "ephemeral"}`,
      ` project ${this.ctx.cwd}`,
      ` state   ${state.status}`,
      ` updated ${new Date(state.updatedAt).toLocaleString()}`,
      "",
      " Recovery is evidence-based. Re-check the tracker, git, gate, and agent transcript before resuming.",
    ];
  }
}

function formatTokens(tokens: number) {
  if (tokens < 1_000) return `${tokens}`;
  if (tokens < 1_000_000) return `${Math.round(tokens / 1_000)}k`;
  return `${(tokens / 1_000_000).toFixed(1)}m`;
}

function statusGlyph(status: WorkflowSubagentSummary["status"]) {
  return status === "running" ? "·" : status === "done" ? "✓" : "×";
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
  if (!route) return "not classified";
  return `${route.mode}${route.stage ? ` · ${route.stage}` : ""} · ${route.reason}`;
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

  const notifyNative = async (title: string, body: string) => {
    try {
      if (process.platform === "darwin") {
        const escape = (value: string) =>
          value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        await pi.exec("osascript", [
          "-e",
          `display notification "${escape(body)}" with title "${escape(title)}"`,
        ]);
      } else if (process.platform === "linux") {
        await pi.exec("notify-send", [title, body]);
      } else if (process.platform === "win32") {
        await pi.exec("powershell", [
          "-NoProfile",
          "-Command",
          `New-BurntToastNotification -Text '${title.replace(/'/g, "''")}', '${body.replace(/'/g, "''")}'`,
        ]);
      }
    } catch {
      // Notifications are optional; the TUI and title remain authoritative.
    }
  };

  const showQuestionBatch = async (
    ctx: ExtensionContext,
    envelope: Extract<ControlEnvelope, { kind: "question_batch" }>,
  ) => {
    if (ctx.mode !== "tui" || !ctx.hasUI || !state.stageAgentId) {
      setState({
        status: "blocked",
        lastEvent: "question requires interactive TUI",
      });
      return;
    }
    const questions = envelope.questions.slice(0, MAX_STAGE_QUESTIONS);
    const answers: Array<{ id: string; answer: string }> = [];
    setState({
      status: "needs-input",
      lastEvent: `${questions.length} decision${questions.length === 1 ? "" : "s"} from ${envelope.stage}`,
    });
    void notifyNative(
      `${envelope.stage} needs you`,
      "A workflow decision is waiting in Pi.",
    );
    for (let index = 0; index < questions.length; index += 1) {
      const question = questions[index];
      const labels = question.options.map((option) => option.label);
      const customLabel = "Write my own answer…";
      const choice = await ctx.ui.select(
        `${envelope.stage} · decision ${index + 1}/${questions.length}: ${question.question}${question.recommendation ? ` · recommended: ${question.recommendation}` : ""}`,
        [...labels, customLabel],
      );
      if (!choice) {
        setState({ status: "blocked", lastEvent: "decision batch cancelled" });
        return;
      }
      const answer =
        choice === customLabel
          ? await ctx.ui.input("Your answer", "Type a decision…")
          : choice;
      if (!answer?.trim()) {
        setState({ status: "blocked", lastEvent: "decision batch cancelled" });
        return;
      }
      answers.push({ id: question.id, answer: answer.trim() });
    }
    await sendToStage(
      state.stageAgentId,
      JSON.stringify({
        kind: "question_answers",
        stage: envelope.stage,
        answers,
      }),
    );
  };

  const handleEnvelope = async (envelope: ControlEnvelope) => {
    const key = JSON.stringify(envelope);
    if (key === lastEnvelope) return;
    lastEnvelope = key;
    if (envelope.kind === "question_batch") {
      await showQuestionBatch(context!, envelope);
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
      void notifyNative(`${envelope.stage} blocked`, envelope.reason);
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
    void notifyNative(`${envelope.stage} complete`, envelope.summary);
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
          ctx,
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
          maxHeight: "80%",
          margin: 2,
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
      "Route work, start a pinned part1-part4 stage, relay a response to a stage, or inspect workflow state.",
    promptSnippet:
      "Route tasks and control Vraj's part1 → part2 → part3 → part4 workflow",
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
        if (!input.id || !input.text)
          throw new Error("workflow send requires id and text.");
        const response = await sendToStage(input.id, input.text);
        return {
          content: [{ type: "text", text: `Sent response to ${input.id}.` }],
          details: response,
        };
      }
      if (!input.prompt) throw new Error("workflow start requires prompt.");
      const decision = classifyRequest(input.prompt);
      const stage = input.stage ?? decision.stage ?? "part1";
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
    const skills = decision.skills.length ? decision.skills.join(", ") : "none";
    return {
      systemPrompt: `${event.systemPrompt}\n\n## Vraj route for this turn\n- Recommendation: ${decision.mode}${decision.stage ? ` via ${decision.stage}` : ""}\n- Reason: ${decision.reason}\n- Supporting skills: ${skills}\n- If this is fleet work, use the workflow tool to start the pinned stage and stop doing the stage's work in the coordinator turn.\n- If a stage result contains a control JSON envelope, honor it: the workflow extension handles questions; broker helper requests with sibling subagents; verify evidence before advancing.\n- Keep user-facing updates terse and put technical detail in /flow.`,
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
