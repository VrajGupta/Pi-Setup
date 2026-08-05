import {
  STAGE_NAMES,
  type StageName,
  type WorkflowReasoningEffort,
} from "../../shared/workflow-state.ts";

export const STAGE_PROFILES = {
  planner: {
    harness: "claude",
    model: "opus",
    defaultReasoning: "high",
    color: "violet",
    label: "plan",
  },
  coder: {
    harness: "pi",
    model: "opencode-go/deepseek-v4-flash",
    defaultReasoning: "high",
    color: "cyan",
    label: "build",
  },
  debugger: {
    harness: "codex",
    model: "gpt-5.6-luna",
    defaultReasoning: "max",
    color: "amber",
    label: "debug",
  },
  reviewer: {
    harness: "pi",
    model: "openrouter/x-ai/grok-4.5",
    defaultReasoning: "high",
    color: "mint",
    label: "review",
  },
} as const satisfies Record<
  StageName,
  {
    harness: "pi" | "claude" | "codex";
    model: string;
    defaultReasoning: WorkflowReasoningEffort;
    color: string;
    label: string;
  }
>;

export interface RouteDecision {
  mode: "direct" | "fleet";
  stage: StageName | null;
  confidence: "high" | "medium";
  reason: string;
  skills: string[];
}

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface QuestionBatchItem {
  id: string;
  question: string;
  recommendation?: string;
  options: QuestionOption[];
}

export type ControlEnvelope =
  | {
      kind: "question_batch";
      stage: StageName;
      questions: QuestionBatchItem[];
      context?: string;
    }
  | {
      kind: "helper_request";
      stage: StageName;
      role: string;
      task: string;
      harness?: "pi" | "claude" | "codex";
      model?: string;
      reasoning_effort?: string;
    }
  | {
      kind: "stage_complete";
      stage: StageName;
      summary: string;
      evidence: string[];
      next?: StageName;
    }
  | {
      kind: "blocked";
      stage: StageName;
      reason: string;
      recovery?: string;
    };

const RISK_TERMS = [
  "auth",
  "permission",
  "tenant",
  "billing",
  "payment",
  "production",
  "migration",
  "database",
  "schema",
  "webhook",
  "provider",
  "secret",
  "credential",
  "deploy",
  "delete",
  "destructive",
  "security",
  "privacy",
];

const BROAD_TERMS = [
  "build",
  "implement",
  "refactor",
  "redesign",
  "integrate",
  "workflow",
  "feature",
  "across",
  "end-to-end",
  "whole",
];

const SKILL_RULES = [
  {
    terms: ["bug", "broken", "throw", "error", "slow", "regression"],
    skill: "diagnose",
  },
  { terms: ["test", "tdd", "integration"], skill: "tdd" },
  {
    terms: ["webhook", "provider", "queue", "payment"],
    skill: "provider-integration-tdd",
  },
  { terms: ["review", "audit", "diff"], skill: "code-review" },
  { terms: ["research", "docs", "compare", "investigate"], skill: "research" },
  { terms: ["ui", "layout", "theme", "polish"], skill: "better-ui" },
  { terms: ["color", "palette", "contrast"], skill: "better-colors" },
  {
    terms: ["font", "typography", "text", "spacing"],
    skill: "better-typography",
  },
];

function hasTerm(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term));
}

/**
 * Legacy positional stage names. Kept as input aliases only so an older prompt,
 * transcript, or handoff that still says "part3" still routes; nothing renders
 * or emits these spellings.
 */
const LEGACY_STAGE_ALIASES: Record<string, StageName> = {
  part1: "planner",
  part2: "coder",
  part3: "debugger",
  part4: "reviewer",
};

function explicitStage(text: string) {
  const legacy = text.match(/\bpart\s*([1-4])\b/i);
  if (legacy) return LEGACY_STAGE_ALIASES[`part${legacy[1]}`];
  const named = text.match(/\/?\b(planner|coder|debugger|reviewer)\b/i);
  return named ? (named[1].toLowerCase() as StageName) : null;
}

function findSkills(text: string) {
  const skills = SKILL_RULES.filter((rule) => hasTerm(text, rule.terms)).map(
    (rule) => rule.skill,
  );
  return [...new Set(skills)];
}

export function classifyRequest(prompt: string): RouteDecision {
  const text = prompt.toLowerCase();
  const stage = explicitStage(text);
  const risk = hasTerm(text, RISK_TERMS);
  const broad = hasTerm(text, BROAD_TERMS);
  const asksForExplanation = /^(why|what|how do i|explain|show me|list)\b/.test(
    text,
  );
  const fleet = Boolean(stage) || risk || (broad && !asksForExplanation);

  if (stage) {
    return {
      mode: "fleet",
      stage,
      confidence: "high",
      reason: `explicit ${stage} request`,
      skills: findSkills(text),
    };
  }

  if (fleet) {
    return {
      mode: "fleet",
      stage: "planner",
      confidence: risk ? "high" : "medium",
      reason: risk
        ? "crosses a high-risk boundary"
        : "broad or ambiguous implementation work",
      skills: findSkills(text),
    };
  }

  return {
    mode: "direct",
    stage: null,
    confidence: asksForExplanation ? "high" : "medium",
    reason: asksForExplanation
      ? "explanatory or read-only request"
      : "small reversible task",
    skills: findSkills(text),
  };
}

function isStageName(value: unknown): value is StageName {
  return typeof value === "string" && STAGE_NAMES.includes(value as StageName);
}

function isQuestionBatch(
  value: Record<string, unknown>,
): value is Extract<ControlEnvelope, { kind: "question_batch" }> {
  if (!isStageName(value.stage) || !Array.isArray(value.questions))
    return false;
  return value.questions.every((question) => {
    if (!question || typeof question !== "object") return false;
    const item = question as Record<string, unknown>;
    return (
      typeof item.id === "string" &&
      typeof item.question === "string" &&
      Array.isArray(item.options) &&
      item.options.length >= 2 &&
      item.options.length <= 5 &&
      item.options.every((option) => {
        if (!option || typeof option !== "object") return false;
        const candidate = option as Record<string, unknown>;
        return typeof candidate.label === "string";
      })
    );
  });
}

function isControlEnvelope(value: unknown): value is ControlEnvelope {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.kind === "question_batch") return isQuestionBatch(record);
  if (record.kind === "helper_request") {
    return (
      isStageName(record.stage) &&
      typeof record.role === "string" &&
      typeof record.task === "string"
    );
  }
  if (record.kind === "stage_complete") {
    return (
      isStageName(record.stage) &&
      typeof record.summary === "string" &&
      Array.isArray(record.evidence) &&
      record.evidence.every((item) => typeof item === "string") &&
      (record.next === undefined || isStageName(record.next))
    );
  }
  return (
    record.kind === "blocked" &&
    isStageName(record.stage) &&
    typeof record.reason === "string" &&
    (record.recovery === undefined || typeof record.recovery === "string")
  );
}

function balancedJsonCandidates(text: string) {
  const candidates: string[] = [];
  for (
    let start = text.indexOf("{");
    start >= 0;
    start = text.indexOf("{", start + 1)
  ) {
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const character = text[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') {
        quoted = true;
        continue;
      }
      if (character === "{") depth += 1;
      if (character === "}") depth -= 1;
      if (depth === 0) {
        candidates.push(text.slice(start, index + 1));
        break;
      }
    }
  }
  return candidates;
}

export function parseControlEnvelope(text: string) {
  for (const candidate of balancedJsonCandidates(text)) {
    try {
      const value: unknown = JSON.parse(candidate);
      if (isControlEnvelope(value)) return value;
    } catch {
      // Try the next balanced object. Stage output may contain prose first.
    }
  }
  return null;
}

export function buildStagePrompt(stage: StageName, task: string, cwd: string) {
  const profile = STAGE_PROFILES[stage];
  return `You are ${stage}, the ${profile.label} stage in Vraj's Pi workflow.

Task:
${task}

Working directory: ${cwd}

Operate directly. Do not spawn agents, delegate, ask interactive UI questions, or claim evidence you did not obtain. The coordinator brokers helpers and relays user answers. Read the repository's ${stage} skill and the relevant project docs before acting.

Control protocol: when you must pause, return exactly one JSON object and stop. Do not wrap it in prose.
- User decisions: {"kind":"question_batch","stage":"${stage}","questions":[{"id":"decision-1","question":"...","recommendation":"...","options":[{"label":"...","description":"..."},{"label":"..."}]}]}
- Specialist help: {"kind":"helper_request","stage":"${stage}","role":"...","task":"...","harness":"pi|claude|codex","model":"provider/model or harness alias","reasoning_effort":"..."}
- Finished: {"kind":"stage_complete","stage":"${stage}","summary":"...","evidence":["runnable command and result", "artifact path"],"next":"coder|debugger|reviewer"}
- Blocked: {"kind":"blocked","stage":"${stage}","reason":"...","recovery":"..."}

When the coordinator sends a question_answers or helper_result message, continue from the saved state. Never silently substitute a stage model. Keep output concise and evidence-first.`;
}
