export const PROGRESS_SOURCES = ["context", "questions", "stage"] as const;
export type ProgressSource = (typeof PROGRESS_SOURCES)[number];

export const STALE_AFTER_MS = 30_000;

export type ProgressReading =
  | {
      readonly kind: "measured";
      readonly percent: number;
      readonly done: number;
      readonly total: number;
      readonly source: ProgressSource;
      readonly at: number;
    }
  | {
      readonly kind: "indeterminate";
      readonly elapsedMs: number;
      readonly turns: number;
      readonly at: number;
    };

export interface ReadingInput {
  readonly source: ProgressSource;
  readonly done?: number | null;
  readonly total?: number | null;
  readonly at: number;
  readonly elapsedMs?: number;
  readonly turns?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isProgressSource(value: unknown): value is ProgressSource {
  return (PROGRESS_SOURCES as readonly unknown[]).includes(value);
}

function safeTimestamp(value: unknown): number {
  return isFiniteNumber(value) ? value : 0;
}

function safeCounter(value: unknown): number {
  return isFiniteNumber(value) && value >= 0 ? value : 0;
}

function makeIndeterminate(
  at: unknown,
  elapsedMs?: unknown,
  turns?: unknown,
): ProgressReading {
  return Object.freeze({
    kind: "indeterminate" as const,
    elapsedMs: safeCounter(elapsedMs),
    turns: safeCounter(turns),
    at: safeTimestamp(at),
  });
}

export function buildReading(input: ReadingInput): ProgressReading {
  if (!isRecord(input)) return makeIndeterminate(0);
  if (!isProgressSource(input.source)) {
    throw new Error(
      `progress source must be one of ${PROGRESS_SOURCES.join("|")}`,
    );
  }
  const { done, total } = input;
  const measurable =
    isFiniteNumber(done) && isFiniteNumber(total) && done > 0 && total > 0;
  if (!measurable) {
    return makeIndeterminate(input.at, input.elapsedMs, input.turns);
  }
  if (!isFiniteNumber(input.at)) return makeIndeterminate(input.at);
  return Object.freeze({
    kind: "measured" as const,
    percent: Math.min(100, Math.max(0, (done / total) * 100)),
    done,
    total,
    source: input.source,
    at: input.at,
  });
}

function isProgressReading(value: unknown): value is ProgressReading {
  if (!isRecord(value) || !isFiniteNumber(value.at)) return false;
  if (value.kind === "measured") {
    return (
      isFiniteNumber(value.percent) &&
      value.percent >= 0 &&
      value.percent <= 100 &&
      isFiniteNumber(value.done) &&
      value.done > 0 &&
      isFiniteNumber(value.total) &&
      value.total > 0 &&
      isProgressSource(value.source)
    );
  }
  return (
    value.kind === "indeterminate" &&
    isFiniteNumber(value.elapsedMs) &&
    value.elapsedMs >= 0 &&
    isFiniteNumber(value.turns) &&
    value.turns >= 0
  );
}

export function isStale(reading: ProgressReading, now = Date.now()): boolean {
  if (!isFiniteNumber(now) || !isProgressReading(reading)) return true;
  return now - reading.at > STALE_AFTER_MS;
}
