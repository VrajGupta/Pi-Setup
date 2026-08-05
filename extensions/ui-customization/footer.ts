import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
  isStale,
  PROGRESS_SOURCES,
  type ProgressReading,
} from "../shared/stage-progress.ts";
import type { WorkflowSubagentSummary } from "../shared/workflow-state.ts";

export const MAX_STAGE_ROWS = 4;

const STAGE_ORDER = ["planner", "coder", "debugger", "reviewer"] as const;
const REASONS = [
  "working",
  "waiting on question",
  "waiting on helper",
  "provider error",
  "quota limit",
  "stale bridge",
  "reason unknown",
] as const;
const SENSITIVE_HEADER_PATTERN = /\b(Authorization|Cookie)\s*:\s*.*/gi;
const SECRET_ASSIGNMENT_PATTERN =
  /(["']?(?:api[_-]?key|access[_-]?key|access[_-]?token|authorization|cookie|credential|password|passwd|private[_-]?key|secret|token)["']?\s*[:=]\s*)(?:"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|[^\s,;}]+)/gi;

export interface FooterTheme {
  fg(color: string, text: string): string;
}

export interface FooterState {
  width: number;
  theme: FooterTheme;
  now: number;
  cwdLabel: string;
  runtime: string;
  rail: string;
  routeStatus: string;
  usage: string;
  pr: string;
  agents: readonly WorkflowSubagentSummary[];
  statuses: readonly string[];
  readingFor: (agent: WorkflowSubagentSummary) => ProgressReading;
  reasonFor?: (agent: WorkflowSubagentSummary) => string;
}

function normalizeWidth(width: unknown) {
  if (typeof width !== "number" || !Number.isFinite(width)) return 0;
  return Math.max(0, Math.floor(width));
}

function stringify(value: unknown, fallback = "") {
  try {
    return value === undefined || value === null ? fallback : String(value);
  } catch {
    return fallback;
  }
}

function oneLine(value: unknown, fallback = "") {
  return stringify(value, fallback)
    .replace(/\r\n?|\n/g, " ")
    .replace(/\t/g, " ");
}

function reasonText(value: unknown) {
  const text = oneLine(value)
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "")
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
    .replace(/\b[a-z][a-z0-9+.-]*:\/{1,2}[^\s]+/gi, "[URL]")
    .replace(/%/g, " percent")
    .trim();
  const reason = REASONS.find(
    (candidate) =>
      text === candidate ||
      (candidate === "provider error" && text.startsWith(`${candidate}:`)),
  );
  return reason ? text : "reason unknown";
}

function paint(theme: FooterTheme | undefined, color: string, text: unknown) {
  const plain = oneLine(text);
  try {
    const styled = theme?.fg(color, plain);
    return typeof styled === "string" ? oneLine(styled) : plain;
  } catch {
    return plain;
  }
}

function safeTruncate(text: string, width: number) {
  try {
    return truncateToWidth(text, width);
  } catch {
    return "";
  }
}

export function columns(left: string, right: string, width: number) {
  const maxWidth = normalizeWidth(width);
  const leftText = oneLine(left);
  const rightText = oneLine(right);
  if (!rightText) return safeTruncate(leftText, maxWidth);
  const gap = maxWidth - visibleWidth(leftText) - visibleWidth(rightText);
  if (gap >= 1) return `${leftText}${" ".repeat(gap)}${rightText}`;
  const leftWidth = Math.max(1, Math.floor(maxWidth * 0.48));
  const rightWidth = Math.max(1, maxWidth - leftWidth - 1);
  return safeTruncate(
    `${safeTruncate(leftText, leftWidth)} ${safeTruncate(rightText, rightWidth)}`,
    maxWidth,
  );
}

function statusGlyph(status: unknown) {
  if (status === "done") return "✓";
  if (status === "error") return "×";
  return "·";
}

function formatElapsed(ms: unknown) {
  const safeMs = typeof ms === "number" && Number.isFinite(ms) ? ms : 0;
  const s = Math.max(0, Math.floor(safeMs / 1_000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h${m % 60}m`;
}

function formatTurns(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    return "0";
  return `${Math.floor(value)}`;
}

function stageIndex(value: unknown) {
  return STAGE_ORDER.findIndex((stage) => stage === value);
}

function hasKnownStage(value: unknown): value is WorkflowSubagentSummary {
  if (typeof value !== "object" || value === null) return false;
  return stageIndex((value as { stage?: unknown }).stage) >= 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isValidReading(value: unknown): value is ProgressReading {
  if (typeof value !== "object" || value === null) return false;
  const reading = value as Record<string, unknown>;
  if (!isFiniteNumber(reading.at)) return false;
  if (reading.kind === "measured") {
    return (
      isFiniteNumber(reading.percent) &&
      reading.percent > 0 &&
      reading.percent <= 100 &&
      isFiniteNumber(reading.done) &&
      reading.done > 0 &&
      isFiniteNumber(reading.total) &&
      reading.total > 0 &&
      (PROGRESS_SOURCES as readonly unknown[]).includes(reading.source) &&
      reading.percent ===
        Math.min(100, Math.max(0, (reading.done / reading.total) * 100))
    );
  }
  return (
    reading.kind === "indeterminate" &&
    isFiniteNumber(reading.elapsedMs) &&
    reading.elapsedMs >= 0 &&
    isFiniteNumber(reading.turns) &&
    reading.turns >= 0
  );
}

function safeElapsed(now: unknown, startedAt: unknown) {
  if (!isFiniteNumber(now) || !isFiniteNumber(startedAt)) return 0;
  return now - startedAt;
}

function displayToken(value: unknown, fallback: string) {
  const text = oneLine(value).replace(/%/g, " percent").trim();
  return text || fallback;
}

function stageRow(
  agent: WorkflowSubagentSummary,
  reading: unknown,
  now: number,
  width: number,
  theme: FooterTheme,
  state: FooterState,
) {
  const elapsed = formatElapsed(safeElapsed(now, agent.startedAt));
  const stage = displayToken(agent.stage, "?");
  const backend = displayToken(agent.backend, "?");
  const model = displayToken(agent.modelLabel, "?");
  const turns = formatTurns(agent.turns);
  const validReading = isValidReading(reading);
  const progress =
    validReading && reading.kind === "measured"
      ? ` · ${reading.percent > 0 && reading.percent < 1 ? "<1" : Math.round(reading.percent)}% ctx`
      : "";
  const stale = !validReading || !isFiniteNumber(now) || isStale(reading, now);
  const reason = reasonText(state.reasonFor?.(agent) ?? "reason unknown");
  const text = `${stale ? "~ " : ""}${reason} · ${statusGlyph(agent.status)} ${stage} ${backend}/${model} · ${elapsed} · ${turns}t${progress}`;
  const rendered = stale
    ? paint(theme, "dim", text)
    : paint(theme, "text", text);
  return safeTruncate(rendered, width);
}

function baseLines(state: FooterState, width: number) {
  return [
    columns(
      paint(state.theme, "text", state.cwdLabel),
      paint(state.theme, "muted", state.runtime),
      width,
    ),
    columns(
      oneLine(state.rail),
      paint(state.theme, "muted", state.routeStatus),
      width,
    ),
    columns(
      paint(state.theme, "muted", state.usage),
      paint(state.theme, "muted", state.pr),
      width,
    ),
  ];
}

function statusLines(statuses: readonly string[], width: number) {
  const lines: string[] = [];
  for (const value of statuses) {
    for (const line of stringify(value).split("\n")) {
      lines.push(safeTruncate(oneLine(line), width));
    }
  }
  return lines;
}

export function renderFooter(state: FooterState) {
  try {
    const width = normalizeWidth(state.width);
    const base = baseLines(state, width);
    try {
      const stageAgents = (Array.isArray(state.agents) ? state.agents : [])
        .filter(hasKnownStage)
        .map((agent, index) => ({ agent, index }))
        .sort(
          (a, b) =>
            stageIndex(a.agent.stage) - stageIndex(b.agent.stage) ||
            a.index - b.index,
        )
        .slice(0, MAX_STAGE_ROWS);
      const rows = stageAgents.map(({ agent }) =>
        stageRow(
          agent,
          state.readingFor(agent),
          state.now,
          width,
          state.theme,
          state,
        ),
      );
      const statuses = Array.isArray(state.statuses)
        ? statusLines(state.statuses, width)
        : [];
      return [...base, ...rows, ...statuses];
    } catch {
      // INV-6: a bad reading or extension status must never take the footer down.
      return base;
    }
  } catch {
    // Keep the three-line contract even if a supplied state/theme is malformed.
    return ["", "", ""];
  }
}
