import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

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
  // Missing/undefined: use default 40
  if (value === undefined) return 40;

  // For any other supplied value (including NaN, non-numbers), clamp to [8, 200]
  // NaN: Math.floor(NaN) = NaN, Math.max(8, Math.min(200, NaN)) = 8
  // Non-number: coerce to number first
  const n =
    typeof value === "number" ? Math.floor(value) : Math.floor(Number(value));

  // Clamp to valid range, treating NaN as 8
  if (!Number.isFinite(n)) return 8;
  return Math.max(8, Math.min(200, n));
}

function safeTruncate(text: string, width: number) {
  try {
    return truncateToWidth(text, width);
  } catch {
    return "";
  }
}

/**
 * Render the belowEditor status widget with deterministic bounds.
 *
 * Given N input lines, returns exactly min(N, maxLines) lines. When N > maxLines,
 * the last line is the overflow line "+N more · /flow" where N is the count of
 * suppressed lines.
 *
 * Every returned line has visible width <= the requested width via truncateToWidth.
 * This is a pure function with no I/O, no timers, and no promises.
 */
export function renderStatusWidget(state: StatusWidgetState): string[] {
  try {
    const width = normalizeWidth(state.width);
    const maxLines = normalizeMaxLines(state.maxLines);
    const inputLines = Array.isArray(state.inputLines) ? state.inputLines : [];

    if (width <= 0) return [];

    const inputCount = inputLines.length;
    if (inputCount === 0) return [];

    // If input fits within maxLines, return all lines truncated to width
    if (inputCount <= maxLines) {
      return inputLines.map((line) => safeTruncate(String(line), width));
    }

    // Input exceeds maxLines: return (maxLines - 1) input lines plus overflow line
    const outputLines = inputLines.slice(0, maxLines - 1);
    const suppressedCount = inputCount - (maxLines - 1);
    const overflowLine = `+${suppressedCount} more · /flow`;

    return [
      ...outputLines.map((line) => safeTruncate(String(line), width)),
      safeTruncate(overflowLine, width),
    ];
  } catch {
    // INV-6: gracefully degrade on any error
    return [];
  }
}
