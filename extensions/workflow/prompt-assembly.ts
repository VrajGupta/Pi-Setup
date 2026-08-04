import type { RouteDecision } from "./src/policy.ts";

const STABLE_WORKFLOW_INSTRUCTIONS = `

## Vraj workflow instructions
- Human messages always go to the orchestrator, never directly to a stage. Interpret them first; relay to an active stage with workflow send only when needed.
- If this is fleet work, use the workflow tool to start the pinned stage and stop doing the stage's work in the coordinator turn.
- If a stage result contains a control JSON envelope, honor it: the workflow extension records questions as awaiting coordinator relay; broker helper requests with sibling subagents; verify evidence before advancing.
- Keep user-facing updates terse and put technical detail in /flow.`;

const SENSITIVE_HEADER_PATTERN =
  /\b(Authorization|Cookie)[ \t]*:[ \t]*[^\r\n]*?(?:\r?\n[ \t]+[^\r\n]*?)*(?=\r?\n(?![ \t])|[ \t]+\b(?:Authorization|Cookie)[ \t]*:|$)/gi;

function redactPromptText(text: string) {
  return text
    .replace(SENSITIVE_HEADER_PATTERN, "$1: [REDACTED]")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [REDACTED]")
    .replace(
      /\b(sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,})\b/g,
      "[REDACTED]",
    )
    .replace(
      /(["']?(?:api[_-]?key|access[_-]?key|access[_-]?token|aws[_-]?access[_-]?key[_-]?id|authorization|cookie|credential|password|passwd|private[_-]?key|secret|token)["']?\s*[:=]\s*)(?:"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|["'][^\r\n]*|[^\r\n]+)/gi,
      "$1[REDACTED]",
    )
    .replace(
      /([?&](?:api[_-]?key|access[_-]?token|key|secret|token)=)[^&#\s]+/gi,
      "$1[REDACTED]",
    )
    .replace(/\bhttps?:\/\/[^\s]+/gi, "[URL]");
}

export function assembleWorkflowSystemPrompt({
  baseSystemPrompt,
  route,
}: {
  baseSystemPrompt: string;
  route: RouteDecision;
}) {
  const stablePrefix = `${redactPromptText(baseSystemPrompt)}${STABLE_WORKFLOW_INSTRUCTIONS}`;
  const skills = redactPromptText(route.skills.join(", ") || "none");
  const volatileSuffix = `

## Vraj route for this turn
- Recommendation: ${redactPromptText(route.mode)}${route.stage ? ` via ${redactPromptText(route.stage)}` : ""}
- Reason: ${redactPromptText(route.reason)}
- Supporting skills: ${skills}`;

  return {
    stablePrefix,
    volatileSuffix,
    systemPrompt: `${stablePrefix}${volatileSuffix}`,
  };
}
