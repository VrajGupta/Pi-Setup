import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export interface FooterTheme {
  fg(color: string, text: string): string;
}

export interface FooterState {
  width: number;
  theme: FooterTheme;
  cwdLabel: string;
  runtime: string;
  usage: string;
  pr: string;
  statuses: readonly string[];
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

function baseLines(state: FooterState, width: number) {
  return [
    columns(
      paint(state.theme, "text", state.cwdLabel),
      paint(state.theme, "muted", state.runtime),
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
      const statuses = Array.isArray(state.statuses)
        ? statusLines(state.statuses, width)
        : [];
      // INV-4: the footer is still capped at 7 lines total (2 base + ≤5
      // extension status lines). Stage rows were removed per PI-26 dedup;
      // they live in the belowEditor status widget.
      const budget = 7 - base.length;
      return [...base, ...statuses.slice(0, Math.max(0, budget))];
    } catch {
      // INV-6: a bad extension status must never take the footer down.
      return base;
    }
  } catch {
    // Keep the three-line contract even if a supplied state/theme is malformed.
    return ["", "", ""];
  }
}
