/**
 * Off-render routine scheduler (PI-28).
 *
 * Pure computation plus injected timers: this module performs no
 * filesystem, network, or subprocess I/O (INV-3). Fixed-interval cadence
 * with an optional minutes-of-day `at` list (spec q1). Per-routine
 * isolation: a throwing handler or malformed definition never kills the
 * scheduler or other routines; the last error is captured per routine
 * (spec q6, INV-16). Single-flight per routine: a fire whose handler is
 * still in progress is skipped, never overlapped (INV-13/INV-15). The
 * recurring timer is unref'd and cleared on stop() (INV-18).
 */

export const MIN_ROUTINE_INTERVAL_MS = 2_000;
export const MAX_ROUTINE_INTERVAL_MS = 300_000;
export const DEFAULT_ROUTINE_INTERVAL_MS = 10_000;
const AT_ONLY_TICK_MS = 60_000;
const MAX_MINUTE_OF_DAY = 1_439;

export interface RoutineDefinition {
  readonly name: string;
  /** Fixed interval between fires, clamped to [2000, 300000]. */
  readonly scheduleMs?: number;
  /** Minutes of day (0-1439) at which the routine fires (spec q1). */
  readonly at?: readonly number[];
  readonly prompt: string;
  readonly enabled?: boolean;
  /** Epoch ms; the routine is skipped while now() < snoozedUntil. */
  readonly snoozedUntil?: number;
}

export interface RoutineState {
  readonly name: string;
  readonly enabled: boolean;
  readonly isDue: boolean;
  readonly isRunning: boolean;
  readonly lastFiredAt?: number;
  readonly lastError?: string;
  readonly configError?: string;
  readonly snoozedUntil?: number;
}

export interface RoutineSnapshot {
  readonly tickCount: number;
  readonly routines: readonly RoutineState[];
}

export interface RoutineScheduler {
  /** Names of routines that were due at the last tick evaluation. */
  getDueRoutineNames(): readonly string[];
  getSnapshot(): RoutineSnapshot;
  /** Stop the scheduler and clear the recurring timer. */
  stop(): void;
}

function clampInterval(value: unknown): number {
  if (value === undefined || value === null || typeof value !== "number") {
    return DEFAULT_ROUTINE_INTERVAL_MS;
  }
  if (!Number.isFinite(value)) return DEFAULT_ROUTINE_INTERVAL_MS;
  return Math.max(
    MIN_ROUTINE_INTERVAL_MS,
    Math.min(MAX_ROUTINE_INTERVAL_MS, value),
  );
}

function minuteOfDay(epochMs: number): number {
  const date = new Date(epochMs);
  return date.getHours() * 60 + date.getMinutes();
}

function reasonFrom(error: unknown): string {
  try {
    const message = error instanceof Error ? error.message.trim() : "";
    return message || "unknown error";
  } catch {
    return "unknown error";
  }
}

function isValidMinute(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_MINUTE_OF_DAY
  );
}

interface RoutineInternal {
  readonly def: RoutineDefinition;
  readonly name: string;
  readonly enabled: boolean;
  readonly validAt?: readonly number[];
  configError?: string;
  isRunning: boolean;
  lastFiredAt?: number;
  lastFiredMinuteKey?: number;
  lastError?: string;
}

function createInternal(def: unknown, seen: Set<string>): RoutineInternal {
  if (typeof def !== "object" || def === null) {
    return {
      def: { name: "", prompt: "" },
      name: "",
      enabled: false,
      isRunning: false,
      configError: "invalid definition",
    };
  }
  const candidate = def as RoutineDefinition;
  const name = typeof candidate.name === "string" ? candidate.name : "";
  if (name === "") {
    return {
      def: candidate,
      name: "",
      enabled: false,
      isRunning: false,
      configError: "invalid name",
    };
  }
  if (seen.has(name)) {
    return {
      def: candidate,
      name,
      enabled: false,
      isRunning: false,
      configError: "duplicate name",
    };
  }
  seen.add(name);
  const prompt = typeof candidate.prompt === "string" ? candidate.prompt : "";
  if (prompt === "") {
    return {
      def: candidate,
      name,
      enabled: false,
      isRunning: false,
      configError: "missing prompt",
    };
  }
  const enabled = candidate.enabled !== false;
  let validAt: readonly number[] | undefined;
  if (Array.isArray(candidate.at)) {
    const filtered = candidate.at.filter(isValidMinute);
    if (filtered.length > 0) {
      validAt = [...new Set(filtered)];
    }
  } else if (candidate.at !== undefined) {
    return {
      def: candidate,
      name,
      enabled,
      isRunning: false,
      configError: "invalid at list",
    };
  }
  const hasInterval = candidate.scheduleMs !== undefined;
  if (!hasInterval && validAt === undefined) {
    return {
      def: candidate,
      name,
      enabled,
      isRunning: false,
      configError: "missing schedule (set scheduleMs or at)",
    };
  }
  return { def: candidate, name, enabled, isRunning: false, validAt };
}

function computeTickMs(states: readonly RoutineInternal[]): number {
  let min: number | undefined;
  let hasAtOnly = false;
  for (const state of states) {
    if (state.configError !== undefined || !state.enabled) continue;
    if (state.def.scheduleMs !== undefined) {
      const clamped = clampInterval(state.def.scheduleMs);
      min = min === undefined ? clamped : Math.min(min, clamped);
    } else if (state.validAt !== undefined) {
      hasAtOnly = true;
    }
  }
  if (min === undefined && !hasAtOnly) return DEFAULT_ROUTINE_INTERVAL_MS;
  return clampInterval(min ?? AT_ONLY_TICK_MS);
}

/**
 * Start an off-render routine scheduler.
 *
 * @param routines - Routine definitions. The scheduler accepts a plain list.
 * @param now - Injected clock (returns epoch ms).
 * @param setTimer - Injected timer function.
 * @param clearTimer - Timer cancellation; defaults to clearTimeout.
 * @param onDue - Called when a routine is due. May return a promise for
 *   single-flight gating; the routine is marked running until the promise settles.
 * @returns { getDueRoutineNames, getSnapshot, stop }
 */
export function startRoutineScheduler({
  routines,
  now,
  setTimer,
  clearTimer,
  onDue,
}: {
  routines: readonly RoutineDefinition[];
  now: () => number;
  setTimer: (callback: () => void, delayMs: number) => NodeJS.Timeout;
  clearTimer?: (handle: NodeJS.Timeout) => void;
  onDue?: (routine: RoutineDefinition) => void | Promise<void>;
}): RoutineScheduler {
  const clear =
    clearTimer ?? ((handle: NodeJS.Timeout) => clearTimeout(handle));
  const startedAt = now();
  const seen = new Set<string>();
  const states: RoutineInternal[] = [];
  for (const def of routines) {
    states.push(createInternal(def, seen));
  }
  const tickMs = computeTickMs(states);
  let tickCount = 0;
  let timer: NodeJS.Timeout | undefined;
  let isStopped = false;
  let dueNames: readonly string[] = [];

  const unref = (handle: NodeJS.Timeout) => {
    if (typeof (handle as NodeJS.Timer).unref === "function") {
      (handle as NodeJS.Timer).unref();
    }
  };

  const settle = (state: RoutineInternal, error: string | undefined) => {
    state.isRunning = false;
    state.lastFiredAt = now();
    if (error !== undefined) state.lastError = error;
  };

  const fire = (state: RoutineInternal, dueAt: number) => {
    state.isRunning = true;
    state.lastError = undefined;
    if (state.validAt !== undefined) {
      state.lastFiredMinuteKey = Math.floor(dueAt / 60_000);
    }
    let result: void | Promise<void>;
    try {
      result = onDue ? onDue(state.def) : undefined;
    } catch (error) {
      settle(state, reasonFrom(error));
      return;
    }
    Promise.resolve(result).then(
      () => settle(state, undefined),
      (error) => settle(state, reasonFrom(error)),
    );
  };

  const isDue = (state: RoutineInternal, nowVal: number): boolean => {
    const def = state.def;
    if (
      def.snoozedUntil !== undefined &&
      typeof def.snoozedUntil === "number" &&
      Number.isFinite(def.snoozedUntil) &&
      nowVal < def.snoozedUntil
    ) {
      return false;
    }
    if (state.validAt !== undefined) {
      const minute = minuteOfDay(nowVal);
      const minuteKey = Math.floor(nowVal / 60_000);
      const atMatch = state.validAt.includes(minute);
      if (
        atMatch &&
        (state.lastFiredMinuteKey === undefined ||
          state.lastFiredMinuteKey !== minuteKey)
      ) {
        return true;
      }
    }
    if (def.scheduleMs !== undefined) {
      const interval = clampInterval(def.scheduleMs);
      const anchor = state.lastFiredAt ?? startedAt;
      if (nowVal - anchor >= interval) return true;
    }
    return false;
  };

  function tick() {
    if (isStopped) return;
    tickCount++;
    const nowVal = now();
    const due: string[] = [];
    for (const state of states) {
      if (state.configError !== undefined || !state.enabled) continue;
      if (!isDue(state, nowVal)) continue;
      due.push(state.name);
      if (!state.isRunning) fire(state, nowVal);
    }
    dueNames = due;
    if (isStopped) return;
    timer = setTimer(tick, tickMs);
    unref(timer);
  }

  if (states.length > 0) {
    timer = setTimer(tick, tickMs);
    unref(timer);
  }

  return {
    getDueRoutineNames() {
      return dueNames;
    },
    getSnapshot() {
      return {
        tickCount,
        routines: states.map((state) => ({
          name: state.name,
          enabled: state.enabled,
          isDue: dueNames.includes(state.name),
          isRunning: state.isRunning,
          lastFiredAt: state.lastFiredAt,
          lastError: state.lastError,
          configError: state.configError,
          snoozedUntil: state.def.snoozedUntil,
        })),
      };
    },
    stop() {
      isStopped = true;
      if (timer) {
        clear(timer);
        timer = undefined;
      }
    },
  };
}
