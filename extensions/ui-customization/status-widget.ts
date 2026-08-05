import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { STALE_AFTER_MS } from "../shared/stage-progress.ts";
import { columns } from "./footer.ts";

const DEFAULT_MAX_LINES = 40;
const DEFAULT_WIDTH = 80;
const STAGE_ORDER = ["planner", "coder", "debugger", "reviewer"] as const;

const SECRET_TOKEN_PATTERN =
  /\b(sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,})\b/g;
const SECRET_ASSIGNMENT_PATTERN =
  /(["']?(?:api[_-]?key|access[_-]?key|access[_-]?token|authorization|cookie|credential|key|password|passwd|private[_-]?key|secret|token)["']?\s*[:=]\s*)(?:"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|[^\s,;}]+)/gi;

export type StatusWidgetContext =
  | { readonly kind: "measured"; readonly percent: number }
  | { readonly kind: "unknown" };

export interface StatusWidgetAgent {
  readonly stage: string;
  readonly status: string;
  readonly backend: string;
  readonly model: string;
  readonly startedAt: number;
  readonly at: number;
  readonly turns: number;
  readonly context: StatusWidgetContext;
}

export interface StatusWidgetState {
  width: number;
  maxLines: unknown;
  inputLines: readonly string[];
  mode?: unknown;
  route?: unknown;
  activeStage?: unknown;
  workflowStatus?: unknown;
  now?: number;
  agents?: readonly StatusWidgetAgent[];
}

// ── helpers ──────────────────────────────────────────────

function normalizeWidth(width: unknown) {
  if (typeof width !== "number" || !Number.isFinite(width)) return 0;
  return Math.max(0, Math.floor(width));
}

function normalizeMaxLines(value: unknown) {
  if (value === undefined) return DEFAULT_MAX_LINES;
  if (typeof value !== "number") return DEFAULT_MAX_LINES;
  if (!Number.isFinite(value)) return 8;
  return Math.max(8, Math.min(200, Math.floor(value)));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function safeString(value: unknown) {
  try {
    return String(value);
  } catch {
    return "?";
  }
}

function safeTruncate(text: string, width: number) {
  try {
    return truncateToWidth(text, width);
  } catch {
    return "";
  }
}

/** Strip control/ANSI and redact secret-shaped tokens (INV-2). */
function safeToken(value: unknown, fallback: string) {
  const text = safeString(value)
    .replace(/\r\n?|\n/g, " ")
    .replace(/\t/g, " ")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "")
    .replace(SECRET_TOKEN_PATTERN, "[REDACTED]")
    .replace(SECRET_ASSIGNMENT_PATTERN, "$1[REDACTED]")
    .trim();
  return text || fallback;
}

// ── row builders ─────────────────────────────────────────

function ruleLine(width: number) {
  const head = "─ flow ─";
  const fill = "─".repeat(Math.max(0, width - visibleWidth(head)));
  return safeTruncate(head + fill, width);
}

function modeLabel(mode: unknown) {
  return mode === "free" ? "mode free (manual)" : "mode workflow";
}

function routeLabel(route: unknown) {
  const r =
    route && typeof route === "object"
      ? (route as Record<string, unknown>)
      : null;
  if (r && r.mode === "fleet") {
    const stage = r.stage != null ? safeToken(String(r.stage), "") : "";
    return stage ? `route fleet/${stage}` : "route fleet";
  }
  return "route direct";
}

function railLine(
  activeStage: unknown,
  workflowStatus: unknown,
  width: number,
) {
  const active = (STAGE_ORDER as readonly string[]).includes(
    safeString(activeStage),
  )
    ? String(activeStage)
    : null;
  const activeIndex = active
    ? STAGE_ORDER.indexOf(active as (typeof STAGE_ORDER)[number])
    : -1;
  const complete = safeString(workflowStatus) === "complete";

  if (width < 60) {
    const label = active ? `◉ ${active}` : "· idle";
    return safeTruncate(label, width);
  }

  const parts = STAGE_ORDER.map((stage) => {
    if (complete) return `✓ ${stage}`;
    if (stage === active) return `◉ ${stage}`;
    if (activeIndex >= 0 && STAGE_ORDER.indexOf(stage) < activeIndex)
      return `✓ ${stage}`;
    return `· ${stage}`;
  });
  return safeTruncate(parts.join("  →  "), width);
}

function agentGlyph(status: unknown) {
  if (status === "running") return "◉";
  if (status === "done") return "✓";
  if (status === "error") return "×";
  return "·";
}

function formatElapsed(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1_000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m < 60) return `${m}m${sec}s`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60}m`;
}

function formatTurns(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    return "0";
  return `${Math.floor(value)}`;
}

function contextCell(context: unknown) {
  if (context && typeof context === "object") {
    const c = context as Record<string, unknown>;
    if (c.kind === "measured" && isFiniteNumber(c.percent)) {
      const p = c.percent;
      if (p >= 1) return `${Math.round(p)}% ctx`;
      if (p > 0) return "<1% ctx";
    }
  }
  return "? ctx";
}

function staleAgentAt(now: number, at: number) {
  return isFiniteNumber(now) && isFiniteNumber(at) && now - at > STALE_AFTER_MS;
}

function safeElapsed(now: unknown, startedAt: unknown) {
  if (!isFiniteNumber(now) || !isFiniteNumber(startedAt)) return 0;
  return Math.max(0, now - startedAt);
}

// ── layout ───────────────────────────────────────────────

function padRight(cell: string, width: number) {
  const pad = width - visibleWidth(cell);
  return pad > 0 ? cell + " ".repeat(pad) : cell;
}

function padLeft(cell: string, width: number) {
  const pad = width - visibleWidth(cell);
  return pad > 0 ? " ".repeat(pad) + cell : cell;
}

/**
 * Tabular layout: computes each column's width once per render from the
 * widest cell (measured with visibleWidth) and pads every cell to it.
 * Numeric columns are right-aligned so digits never jitter.
 */
export function layoutColumns(
  rows: readonly (readonly (string | null)[])[],
  rightAligned: readonly number[],
  totalWidth: number,
): string[] {
  if (rows.length === 0) return [];
  const colCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const colWidths: number[] = [];
  for (let col = 0; col < colCount; col++) {
    let widest = 0;
    for (const row of rows) {
      const cell = row[col];
      if (cell === null) continue;
      widest = Math.max(widest, visibleWidth(cell));
    }
    colWidths[col] = widest;
  }
  return rows.map((row) => {
    const cells = row.map((cell, col) => {
      if (cell === null || colWidths[col] === 0) return null;
      return rightAligned.includes(col)
        ? padLeft(cell, colWidths[col])
        : padRight(cell, colWidths[col]);
    });
    return safeTruncate(
      cells.filter((c): c is string => c !== null).join("  "),
      totalWidth,
    );
  });
}

// ── agent rows ───────────────────────────────────────────

function agentRows(
  agents: readonly StatusWidgetAgent[],
  now: number,
  width: number,
) {
  const showBackend = width >= 100;
  const rows = agents
    .filter((a) => (STAGE_ORDER as readonly string[]).includes(a.stage))
    .sort((a, b) => {
      const ai = (STAGE_ORDER as readonly string[]).indexOf(a.stage);
      const bi = (STAGE_ORDER as readonly string[]).indexOf(b.stage);
      return ai - bi;
    })
    .map((agent) => {
      const stage = safeToken(agent.stage, "?");
      const glyph = agentGlyph(agent.status);
      const elapsed = formatElapsed(safeElapsed(now, agent.startedAt));
      const stale = staleAgentAt(now, agent.at);
      return [
        `${glyph} ${stage}`,
        showBackend
          ? `${safeToken(agent.backend, "?")}/${safeToken(agent.model, "?")}`
          : null,
        stale ? `~${elapsed}` : elapsed,
        `${formatTurns(agent.turns)}t`,
        contextCell(agent.context),
      ] as const;
    });
  return layoutColumns(
    rows as readonly (readonly (string | null)[])[],
    [2, 3, 4],
    width,
  );
}

// ── base lines (fallback) ───────────────────────────────

function baseLines(width: number) {
  return [
    ruleLine(width),
    columns(modeLabel(undefined), routeLabel(undefined), width),
    railLine(undefined, undefined, width),
  ];
}

// ── public API ───────────────────────────────────────────

export function renderStatusWidget(state: StatusWidgetState): string[] {
  if (!state || typeof state !== "object") return [];

  let width: number;
  try {
    width = normalizeWidth(state.width);
  } catch {
    return baseLines(DEFAULT_WIDTH);
  }
  if (width <= 0) return [];

  let maxLines: number;
  try {
    maxLines = normalizeMaxLines(state.maxLines);
  } catch {
    return baseLines(width);
  }

  let inputLines: unknown;
  try {
    inputLines = state.inputLines;
  } catch {
    return baseLines(width);
  }
  if (!Array.isArray(inputLines)) return [];

  try {
    const now =
      typeof state.now === "number" && Number.isFinite(state.now)
        ? state.now
        : Date.now();
    const agents = Array.isArray(state.agents) ? state.agents : [];

    const base = [
      ruleLine(width),
      columns(modeLabel(state.mode), routeLabel(state.route), width),
      railLine(state.activeStage, state.workflowStatus, width),
      ...agentRows(agents, now, width),
    ];
    const lines = [
      ...base.map((line) => safeTruncate(safeString(line), width)),
      ...inputLines.map((line) => safeTruncate(safeString(line), width)),
    ];

    if (lines.length <= maxLines) return lines;

    const visibleLines = lines.slice(0, maxLines - 1);
    const suppressedCount = lines.length - visibleLines.length;
    return [
      ...visibleLines,
      safeTruncate(`+${suppressedCount} more · /flow`, width),
    ];
  } catch {
    return baseLines(width);
  }
}
