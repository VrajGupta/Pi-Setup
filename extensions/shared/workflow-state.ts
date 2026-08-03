import type { ModelRegistry } from "@earendil-works/pi-coding-agent";

export const WORKFLOW_STATE_CHANNEL = "vraj:workflow-state";
export const SUBAGENT_BRIDGE_CHANNEL = "vraj:subagent-bridge";
export const SUBAGENT_STATE_CHANNEL = "vraj:subagent-state";

export const STAGE_NAMES = ["part1", "part2", "part3", "part4"] as const;
export type StageName = (typeof STAGE_NAMES)[number];
export type WorkflowReasoningEffort =
  "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export type WorkflowStatus =
  | "idle"
  | "routing"
  | "running"
  | "needs-input"
  | "needs-helper"
  | "blocked"
  | "complete"
  | "recoverable";

export interface WorkflowState {
  status: WorkflowStatus;
  activeStage: StageName | null;
  route: {
    mode: "direct" | "fleet";
    stage: StageName | null;
    confidence: "high" | "medium";
    reason: string;
    skills: string[];
  } | null;
  taskPreview: string;
  stageAgentId: string | null;
  agentIds: string[];
  lastEvent: string;
  updatedAt: number;
}

export interface WorkflowSubagentSummary {
  id: string;
  title: string;
  status: "running" | "done" | "error";
  backend: "pi" | "claude" | "codex";
  modelLabel?: string;
  contextTokens?: number;
  contextWindow?: number;
  turns: number;
}

export interface WorkflowParentContext {
  parentCwd: string;
  projectTrusted: boolean;
  inheritedModel?: { provider: string; id: string };
  inheritedThinkingLevel: WorkflowReasoningEffort;
  modelRegistry: ModelRegistry;
}

export interface WorkflowBridgeSuccess {
  ok: true;
  id?: string;
  title?: string;
  summaries?: WorkflowSubagentSummary[];
}

export interface WorkflowBridgeFailure {
  ok: false;
  error: string;
}

export type WorkflowBridgeResponse =
  WorkflowBridgeSuccess | WorkflowBridgeFailure;

export interface WorkflowSpawnRequest {
  kind: "spawn";
  prompt: string;
  title: string;
  cwd: string;
  harness: "pi" | "claude" | "codex";
  model?: string;
  reasoningEffort?: WorkflowReasoningEffort;
  parent: WorkflowParentContext;
  resolve: (response: WorkflowBridgeResponse) => void;
}

export interface WorkflowSendRequest {
  kind: "send";
  id: string;
  text: string;
  resolve: (response: WorkflowBridgeResponse) => void;
}

export interface WorkflowListRequest {
  kind: "list";
  resolve: (response: WorkflowBridgeResponse) => void;
}

export type WorkflowBridgeRequest =
  WorkflowSpawnRequest | WorkflowSendRequest | WorkflowListRequest;

export function emptyWorkflowState(): WorkflowState {
  return {
    status: "idle",
    activeStage: null,
    route: null,
    taskPreview: "",
    stageAgentId: null,
    agentIds: [],
    lastEvent: "",
    updatedAt: Date.now(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isWorkflowBridgeRequest(
  value: unknown,
): value is WorkflowBridgeRequest {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (typeof value.resolve !== "function") return false;
  if (value.kind === "spawn") {
    return (
      typeof value.prompt === "string" &&
      typeof value.title === "string" &&
      typeof value.cwd === "string" &&
      (value.harness === "pi" ||
        value.harness === "claude" ||
        value.harness === "codex")
    );
  }
  if (value.kind === "send") {
    return typeof value.id === "string" && typeof value.text === "string";
  }
  return value.kind === "list";
}

export function isWorkflowSubagentSummary(
  value: unknown,
): value is WorkflowSubagentSummary {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    (value.status === "running" ||
      value.status === "done" ||
      value.status === "error") &&
    (value.backend === "pi" ||
      value.backend === "claude" ||
      value.backend === "codex") &&
    typeof value.turns === "number"
  );
}
