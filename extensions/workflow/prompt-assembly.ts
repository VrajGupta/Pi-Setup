import type { RouteDecision } from "./src/policy.ts";

const STABLE_WORKFLOW_INSTRUCTIONS = `

## Vraj workflow instructions
- Human messages always go to the orchestrator, never directly to a stage. Interpret them first; relay to an active stage with workflow send only when needed.
- If this is fleet work, use the workflow tool to start the pinned stage and stop doing the stage's work in the coordinator turn.
- If a stage result contains a control JSON envelope, honor it: the workflow extension records questions as awaiting coordinator relay; broker helper requests with sibling subagents; verify evidence before advancing.
- Keep user-facing updates terse and put technical detail in /flow.`;

const SENSITIVE_HEADER_PATTERN =
  /\b(Authorization|Cookie)[ \t]*:[ \t]*[^\r\n]*?(?:\r?\n[ \t]+[^\r\n]*?)*(?=\r?\n(?![ \t])|[ \t]+\b(?:Authorization|Cookie)[ \t]*:|$)/gi;

const URI_TOKEN_PATTERN = /\b[a-z][a-z0-9+.-]*:[^\s]+/gi;
const CREDENTIAL_URI_PATTERN =
  /\/\/[^/\s:@]+:[^@\s]+@|(?:^|[:/])[^/\s:@]+\/[^@\s/]+@/i;

function redactCredentialUris(text: string) {
  return text.replace(URI_TOKEN_PATTERN, (candidate) => {
    const schemeEnd = candidate.indexOf(":");
    const opaquePart = candidate.slice(schemeEnd + 1);
    return CREDENTIAL_URI_PATTERN.test(opaquePart) ? "[URL]" : candidate;
  });
}

/**
 * PI-07 supports named assignments (`api_key`, `access_key`, `access_token`,
 * `aws_access_key_id`, `authorization`, `cookie`, `credential`, `password`,
 * `passwd`, `private_key`, `secret`, `token`, `*_url`, `*_uri`),
 * Authorization/Cookie headers (including folded continuations), Bearer/Basic
 * and recognized token formats, hierarchical or slash-prefixed credential URIs,
 * and query-string credentials.
 *
 * Excluded: opaque/rootless colon-delimited userinfo with no `//` root or `/`
 * separator (for example, `sip:user:password@example.test`). This is a known,
 * accepted residual risk under unchanged global INV-2, not a PI-07 guarantee.
 */
function redactPromptText(text: string) {
  const redacted = text
    .replace(SENSITIVE_HEADER_PATTERN, "$1: [REDACTED]")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [REDACTED]")
    .replace(
      /\b(sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,})\b/g,
      "[REDACTED]",
    )
    .replace(
      /(["']?(?:api[_-]?key|access[_-]?key|access[_-]?token|aws[_-]?access[_-]?key[_-]?id|authorization|cookie|credential|password|passwd|private[_-]?key|secret|token|[a-z][a-z0-9_-]*[_-](?:url|uri))["']?\s*[:=]\s*)(?:"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|["'][^\r\n]*|[^\r\n]+)/gi,
      "$1[REDACTED]",
    )
    .replace(
      /([?&](?:api[_-]?key|access[_-]?token|key|secret|token)=)[^&#\s]+/gi,
      "$1[REDACTED]",
    );

  return redactCredentialUris(redacted).replace(
    /\b[a-z][a-z0-9+.-]*:\/{1,2}[^\s]+/gi,
    "[URL]",
  );
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
