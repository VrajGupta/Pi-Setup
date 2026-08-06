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

export interface StatusWidgetIssueRecord {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly assignee?: string;
  readonly blockedBy: readonly {
    readonly id: string;
    readonly satisfied: boolean;
  }[];
  readonly blocking: string;
}

export interface StatusWidgetSnapshotView {
  readonly capturedAt: number;
  readonly records: readonly StatusWidgetIssueRecord[];
  readonly reason?: string;
}

export interface StatusWidgetRoutineRecord {
  readonly name: string;
  readonly schedule: string;
  readonly enabled: boolean;
  readonly snoozedUntil?: number;
  readonly dueAt: number;
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
  ticketSnapshot?: StatusWidgetSnapshotView;
  routines?: readonly StatusWidgetRoutineRecord[];
}

// ── helpers ──────────────────────────────────────────────

function normalizeWidth(width: unknown) {
  if (typeof width !== "number" || !Number.isFinite(width)) return 0;
  return Math.max(0, Math.floor(width));
}

/**
 * Normalize `workflow.statusWidget.maxLines` (PI-37): `0` means unlimited
 * (the `+N more` cap is not applied), any other numeric value is clamped to
 * `[8, 200]`, and absent/non-numeric values yield the default 40. The
 * unlimited sentinel is `Infinity`, so the existing `lines.length <= maxLines`
 * early return emits every deterministic line with no overflow.
 */
export function normalizeMaxLines(value: unknown) {
  if (value === undefined) return DEFAULT_MAX_LINES;
  if (typeof value !== "number" || Number.isNaN(value))
    return DEFAULT_MAX_LINES;
  if (value === 0) return Number.POSITIVE_INFINITY;
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
    const stage = r.stage != null ? safeToken(r.stage, "") : "";
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

// ── issue rows ───────────────────────────────────────────

const STATUS_LABEL: Readonly<Record<string, string>> = {
  "agent-ready": "ready",
  "debugger-ready": "dbg-ready",
  "review-ready": "rev-ready",
  unknown: "?",
};

const PIPELINE_ORDER: readonly string[] = [
  "agent-ready",
  "coding",
  "debugger-ready",
  "debugging",
  "review-ready",
  "reviewing",
  "planned",
];

const DONE_STATUSES: readonly string[] = [
  "done",
  "dropped",
  "canceled",
  "duplicate",
];

function issueStatusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

function isDisplayedStatus(status: string): boolean {
  return PIPELINE_ORDER.includes(status);
}

function isDoneStatus(status: string): boolean {
  return DONE_STATUSES.includes(status);
}

function statusOrder(status: string): number {
  const idx = PIPELINE_ORDER.indexOf(status);
  return idx >= 0 ? idx : PIPELINE_ORDER.length;
}

function blockerSummary(
  blockedBy: readonly { readonly id: string; readonly satisfied: boolean }[],
  blocking: string,
): string {
  if (!Array.isArray(blockedBy) || blockedBy.length === 0) return "blk none";
  if (blocking === "blocked (cycle)") return "blk cycle";
  const parts = blockedBy.map((b) => {
    try {
      const id = safeToken(b?.id, "?");
      return `${id} ${b.satisfied ? "✓" : "·"}`;
    } catch {
      return "? ?";
    }
  });
  return `blk ${parts.join(" ")}`;
}

function issueRuleLine(
  records: readonly StatusWidgetIssueRecord[],
  capturedAt: number,
  now: number,
  width: number,
): string {
  const active = records.filter((r) => isDisplayedStatus(r.status)).length;
  const done = records.filter((r) => isDoneStatus(r.status)).length;
  const stale =
    isFiniteNumber(now) &&
    isFiniteNumber(capturedAt) &&
    now - capturedAt > STALE_AFTER_MS;
  const age = stale
    ? ` · ~${formatElapsed(Math.max(0, now - capturedAt))}`
    : "";
  const head = `─ issues · ${active} active · ${done} done${age} ─`;
  const fill = "─".repeat(Math.max(0, width - visibleWidth(head)));
  return safeTruncate(head + fill, width);
}

function issueRows(
  records: readonly StatusWidgetIssueRecord[],
  width: number,
): string[] {
  if (records.length === 0) return [];
  const collapsed = width < 60;

  const displayed = records
    .filter((r) => isDisplayedStatus(r.status))
    .sort((a, b) => {
      const order = statusOrder(a.status) - statusOrder(b.status);
      if (order !== 0) return order;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

  if (displayed.length === 0) return [];

  const cellData = displayed
    .map((r) => {
      try {
        if (!r || typeof r !== "object") return null;
        return {
          id: safeToken(r.id, "?"),
          status: safeToken(issueStatusLabel(r.status), "?"),
          assignee: safeToken(r.assignee, "—"),
          blk: blockerSummary(r.blockedBy, r.blocking),
          title: safeToken(r.title, "—"),
        };
      } catch {
        return null;
      }
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  const idW = Math.max(...cellData.map((c) => visibleWidth(c.id)));
  const statusW = Math.max(...cellData.map((c) => visibleWidth(c.status)));
  const blkW = Math.max(...cellData.map((c) => visibleWidth(c.blk)));
  const gutter = 2;

  if (collapsed) {
    const rows = cellData.map((c) => [c.id, c.status, c.blk]);
    return layoutColumns(
      rows as readonly (readonly (string | null)[])[],
      [],
      width,
    );
  }

  const assigneeW = Math.max(...cellData.map((c) => visibleWidth(c.assignee)));
  const titleW = Math.max(
    3,
    width -
      (idW + gutter + statusW + gutter + assigneeW + gutter + blkW + gutter),
  );

  const rows = cellData.map((c) => [
    c.id,
    c.status,
    c.assignee,
    safeTruncate(c.title, titleW),
    c.blk,
  ]);
  return layoutColumns(
    rows as readonly (readonly (string | null)[])[],
    [],
    width,
  );
}

function issueSection(
  snapshot: StatusWidgetSnapshotView | undefined,
  now: number,
  width: number,
): string[] {
  try {
    // No snapshot provided → omit the issues section entirely (keeps the
    // surface minimal until a snapshot source is wired in).
    if (!snapshot) return [];
    if (snapshot.reason) {
      return [
        safeTruncate(
          `issues unavailable — ${safeToken(snapshot.reason, "?")}`,
          width,
        ),
      ];
    }
    const records = Array.isArray(snapshot.records)
      ? snapshot.records.filter(
          (r): r is NonNullable<typeof r> => r != null && typeof r === "object",
        )
      : [];
    const rule = issueRuleLine(records, snapshot.capturedAt, now, width);
    const rows = issueRows(records, width);
    return [rule, ...rows];
  } catch {
    return [safeTruncate("issues unavailable — render error", width)];
  }
}

// ── routine rows ──────────────────────────────────────────

function formatRelative(ms: number): string {
  if (!Number.isFinite(ms)) return "?";
  if (ms < 60_000) return "due now";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `~${m}m`;
  const h = Math.floor(m / 60);
  return `~${h}h${m % 60}m`;
}

function routineStatusToken(r: StatusWidgetRoutineRecord, now: number): string {
  if (!r.enabled) return "disabled";
  if (!isFiniteNumber(r.dueAt)) return "?";
  if (isFiniteNumber(r.snoozedUntil) && r.snoozedUntil > now) {
    const remaining = Math.max(0, r.snoozedUntil - now);
    const m = Math.ceil(remaining / 60_000);
    return `snoozed (${m}m)`;
  }
  return formatRelative(Math.max(0, now - r.dueAt));
}

function routineRows(
  routines: readonly StatusWidgetRoutineRecord[],
  now: number,
  width: number,
): string[] {
  if (routines.length === 0) return [];
  // Per-row isolation: filter out null/undefined entries before any access.
  const safe = routines.filter(
    (r): r is StatusWidgetRoutineRecord => r != null && typeof r === "object",
  );
  if (safe.length === 0) return [];
  const collapsed = width < 60;

  const due = safe.filter(
    (r) =>
      r.enabled &&
      isFiniteNumber(r.dueAt) &&
      r.dueAt <= now &&
      (!isFiniteNumber(r.snoozedUntil) || r.snoozedUntil <= now),
  );
  const snoozed = safe.filter(
    (r) => r.enabled && isFiniteNumber(r.snoozedUntil) && r.snoozedUntil > now,
  );
  const disabled = safe.filter((r) => !r.enabled);

  const display = collapsed ? due : [...due, ...snoozed, ...disabled];
  if (display.length === 0) return [];

  if (collapsed) {
    // Collapsed: only due, name + status token
    const rows = display.map((r) => {
      const name = safeToken(r.name, "?");
      const token = routineStatusToken(r, now);
      return `${name}  ${token}`;
    });
    return rows.map((row) => safeTruncate(row, width));
  }

  // Full: name + schedule + status token
  const cellData = display
    .map((r) => {
      try {
        return {
          name: safeToken(r.name, "?"),
          schedule: safeToken(r.schedule, "?"),
          token: routineStatusToken(r, now),
        };
      } catch {
        return null;
      }
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  const nameW = Math.max(...cellData.map((c) => visibleWidth(c.name)));
  const scheduleW = Math.max(...cellData.map((c) => visibleWidth(c.schedule)));

  const rows = cellData.map((c) => {
    const name = padRight(c.name, nameW);
    const schedule = padRight(c.schedule, scheduleW);
    return safeTruncate(`${name}  ${schedule}  ${c.token}`, width);
  });
  return rows;
}

function routineSection(
  routines: readonly StatusWidgetRoutineRecord[] | undefined,
  now: number,
  width: number,
): string[] {
  try {
    if (!routines || !Array.isArray(routines) || routines.length === 0)
      return [];
    const safe = routines.filter(
      (r): r is StatusWidgetRoutineRecord => r != null && typeof r === "object",
    );
    if (safe.length === 0) return [];
    const dueCount = safe.filter(
      (r) =>
        r.enabled &&
        isFiniteNumber(r.dueAt) &&
        r.dueAt <= now &&
        (!isFiniteNumber(r.snoozedUntil) || r.snoozedUntil <= now),
    ).length;
    const head = `─ routines · ${dueCount} due ─`;
    const fill = "─".repeat(Math.max(0, width - visibleWidth(head)));
    const rule = safeTruncate(head + fill, width);
    const rows = routineRows(routines, now, width);
    return [rule, ...rows];
  } catch {
    return [];
  }
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
    let snapshot: StatusWidgetSnapshotView | undefined;
    try {
      snapshot = state.ticketSnapshot;
    } catch {
      snapshot = undefined;
    }
    const issues = issueSection(snapshot, now, width);
    let routines: readonly StatusWidgetRoutineRecord[] | undefined;
    try {
      routines = state.routines;
    } catch {
      routines = undefined;
    }
    const routineLines = routineSection(routines, now, width);
    const lines = [
      ...base.map((line) => safeTruncate(safeString(line), width)),
      ...issues,
      ...routineLines,
      ...inputLines.map((line) => safeTruncate(safeToken(line, ""), width)),
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
