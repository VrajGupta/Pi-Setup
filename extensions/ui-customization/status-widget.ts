import { truncateToWidth } from "@earendil-works/pi-tui";

const DEFAULT_MAX_LINES = 40;
const DEFAULT_WIDTH = 80;
const BASE_LINES = [
  "─ flow ─",
  "mode ? · route ?",
  "· planner → · coder → · debugger → · reviewer",
] as const;

export interface StatusWidgetState {
  width: number;
  maxLines: unknown;
  inputLines: readonly string[];
}

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

function renderBaseLines(width: number) {
  return BASE_LINES.map((line) => safeTruncate(line, width));
}

/**
 * Render the belowEditor status widget with deterministic bounds.
 *
 * Empty input renders the three host lines. Non-empty input is rendered as-is
 * until the runaway ceiling is reached; the final line then reports every
 * suppressed row. The render path is pure: no filesystem, network,
 * subprocess, timer, or promise work occurs here.
 */
export function renderStatusWidget(state: StatusWidgetState): string[] {
  if (!state || typeof state !== "object") return [];

  let width: number;
  try {
    width = normalizeWidth(state.width);
  } catch {
    return renderBaseLines(DEFAULT_WIDTH);
  }
  if (width <= 0) return [];

  let maxLines: number;
  try {
    maxLines = normalizeMaxLines(state.maxLines);
  } catch {
    return renderBaseLines(width);
  }

  let inputLines: unknown;
  try {
    inputLines = state.inputLines;
  } catch {
    return renderBaseLines(width);
  }
  if (!Array.isArray(inputLines)) return [];

  try {
    const lines = inputLines.length === 0 ? BASE_LINES : inputLines;
    if (lines.length <= maxLines)
      return lines.map((line) => safeTruncate(safeString(line), width));

    const visibleLines = lines.slice(0, maxLines - 1);
    const suppressedCount = lines.length - visibleLines.length;
    return [
      ...visibleLines.map((line) => safeTruncate(safeString(line), width)),
      safeTruncate(`+${suppressedCount} more · /flow`, width),
    ];
  } catch {
    return renderBaseLines(width);
  }
}
