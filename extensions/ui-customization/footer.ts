import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { isStale, type ProgressReading } from "../shared/stage-progress.ts";
import type { WorkflowSubagentSummary } from "../shared/workflow-state.ts";

export const MAX_STAGE_ROWS = 4;

const STAGE_ORDER = ["part1", "part2", "part3", "part4"] as const;

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
}

export function columns(left: string, right: string, width: number) {
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

function statusGlyph(status: WorkflowSubagentSummary["status"]) {
  if (status === "done") return "✓";
  if (status === "error") return "×";
  return "·";
}

function formatElapsed(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1_000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h${m % 60}m`;
}

function stageRow(
  agent: WorkflowSubagentSummary,
  reading: ProgressReading,
  now: number,
  width: number,
  theme: FooterTheme,
) {
  const elapsed = formatElapsed(now - agent.startedAt);
  const progress =
    reading.kind === "measured" ? ` · ${Math.round(reading.percent)}%` : "";
  const text = `${statusGlyph(agent.status)} ${agent.stage} ${agent.backend}/${agent.modelLabel ?? "?"} · ${elapsed} · ${agent.turns}t${progress}`;
  const stale = isStale(reading, now);
  return truncateToWidth(
    stale ? theme.fg("dim", `~ ${text}`) : theme.fg("text", text),
    width,
  );
}

export function renderFooter(state: FooterState) {
  const { width, theme } = state;
  const base = [
    columns(
      theme.fg("text", state.cwdLabel),
      theme.fg("muted", state.runtime),
      width,
    ),
    columns(state.rail, theme.fg("muted", state.routeStatus), width),
    columns(theme.fg("muted", state.usage), theme.fg("muted", state.pr), width),
  ];
  let rows: string[];
  try {
    rows = state.agents
      .filter((agent) => agent.stage !== undefined)
      .sort(
        (a, b) =>
          STAGE_ORDER.indexOf(a.stage ?? "part1") -
          STAGE_ORDER.indexOf(b.stage ?? "part1"),
      )
      .slice(0, MAX_STAGE_ROWS)
      .map((agent) =>
        stageRow(agent, state.readingFor(agent), state.now, width, theme),
      );
  } catch {
    // INV-6: a bad reading must never take the footer down.
    return base;
  }
  const statuses = state.statuses.flatMap((value) =>
    value.split("\n").map((line) => truncateToWidth(line, width)),
  );
  return [...base, ...rows, ...statuses];
}
