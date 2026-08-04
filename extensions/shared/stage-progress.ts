export const PROGRESS_SOURCES = ["context", "questions", "stage"] as const;
export type ProgressSource = (typeof PROGRESS_SOURCES)[number];

export const STALE_AFTER_MS = 30_000;

export type ProgressReading =
  | {
      kind: "measured";
      percent: number;
      done: number;
      total: number;
      source: ProgressSource;
      at: number;
    }
  | { kind: "indeterminate"; elapsedMs: number; turns: number; at: number };

export interface ReadingInput {
  source: ProgressSource;
  done?: number | null;
  total?: number | null;
  at: number;
  elapsedMs?: number;
  turns?: number;
}

export function buildReading(input: ReadingInput): ProgressReading {
  if (!(PROGRESS_SOURCES as readonly string[]).includes(input.source)) {
    throw new Error(
      `progress source must be one of ${PROGRESS_SOURCES.join("|")}`,
    );
  }
  const { done, total } = input;
  const measurable =
    typeof done === "number" &&
    Number.isFinite(done) &&
    typeof total === "number" &&
    Number.isFinite(total) &&
    total > 0;
  if (!measurable) {
    return {
      kind: "indeterminate",
      elapsedMs: input.elapsedMs ?? 0,
      turns: input.turns ?? 0,
      at: input.at,
    };
  }
  return {
    kind: "measured",
    percent: Math.min(100, Math.max(0, (done / total) * 100)),
    done,
    total,
    source: input.source,
    at: input.at,
  };
}

export function isStale(reading: ProgressReading, now = Date.now()): boolean {
  return now - reading.at > STALE_AFTER_MS;
}
