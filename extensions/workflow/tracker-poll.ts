import type { TicketSnapshot } from "../shared/ticket-snapshot.ts";

/**
 * A fixed-interval poll of the tracker that runs off the render path.
 * Single-flight: at most one read in flight at a time. Failed reads
 * preserve the previous snapshot with a reason. The timer is unref'd and
 * cleared on stop().
 */

export interface TrackerPollSnapshot {
  readonly repo: string;
  readonly capturedAt: number;
  readonly records?: readonly TicketSnapshot["records"][number][];
  readonly reason?: string;
}

export interface TrackerPoll {
  /** Return the most recent snapshot, or undefined if never completed. */
  getSnapshot(): TrackerPollSnapshot | undefined;
  /** Stop the poll and clear the timer. */
  stop(): void;
}

/**
 * Clamp a value to a range, with a default fallback for invalid inputs.
 */
function clampInterval(
  value: unknown,
  min: number,
  max: number,
  defaultValue: number,
) {
  if (value === undefined || value === null || typeof value !== "number") {
    return defaultValue;
  }
  if (!Number.isFinite(value)) return defaultValue;
  return Math.max(min, Math.min(max, value));
}

function isTicketSnapshot(value: unknown): value is TicketSnapshot {
  if (typeof value !== "object" || value === null) return false;
  try {
    const candidate = value as {
      repo?: unknown;
      capturedAt?: unknown;
      records?: unknown;
      reason?: unknown;
    };
    return (
      typeof candidate.repo === "string" &&
      Number.isFinite(candidate.capturedAt) &&
      Array.isArray(candidate.records) &&
      candidate.records.every((record) => {
        if (typeof record !== "object" || record === null) return false;
        return (record as { repo?: unknown }).repo === candidate.repo;
      }) &&
      (candidate.reason === undefined || typeof candidate.reason === "string")
    );
  } catch {
    return false;
  }
}

function reasonFrom(error: unknown) {
  try {
    const message = error instanceof Error ? error.message.trim() : "";
    return message || "unknown error";
  } catch {
    return "unknown error";
  }
}

/**
 * Start a fixed-interval off-render tracker poll.
 *
 * @param intervalMs - Polling interval, clamped to [2000, 300000], default 10000.
 * @param read - Async read function; resolves to a TicketSnapshot.
 * @param now - Injected clock for testing (returns epoch ms).
 * @param setTimer - Injected timer function for testing.
 * @param clearTimer - Matching timer cancellation function for testing.
 * @param onSnapshot - Called with the snapshot after every completed read
 *   (success or reasoned failure), so a consumer can publish it off the render
 *   path without polling getSnapshot() itself.
 * @returns Poll object with getSnapshot() and stop().
 */
export function startTrackerPoll({
  intervalMs,
  read,
  now,
  setTimer,
  clearTimer = (handle: NodeJS.Timeout) => clearTimeout(handle),
  onSnapshot,
}: {
  intervalMs: unknown;
  read: () => Promise<TicketSnapshot>;
  now: () => number;
  setTimer: (callback: () => void, delayMs: number) => NodeJS.Timeout;
  clearTimer?: (handle: NodeJS.Timeout) => void;
  onSnapshot?: (snapshot: TrackerPollSnapshot) => void;
}): TrackerPoll {
  const clampedInterval = clampInterval(intervalMs, 2000, 300000, 10000);
  const readTimeoutMs = clampedInterval;

  let snapshot: TrackerPollSnapshot | undefined;
  let isInFlight = false;
  let timer: NodeJS.Timeout | undefined;
  let activeTimeout: NodeJS.Timeout | undefined;
  let isStopped = false;

  const unref = (handle: NodeJS.Timeout) => {
    if (typeof (handle as NodeJS.Timer).unref === "function")
      (handle as NodeJS.Timer).unref();
  };

  const clearActiveTimeout = (handle: NodeJS.Timeout) => {
    if (activeTimeout !== handle) return;
    clearTimer(handle);
    activeTimeout = undefined;
  };

  const recordFailure = (reason: string, repo = snapshot?.repo ?? "") => {
    const safeReason = reason.trim() || "unknown error";
    snapshot = snapshot
      ? { ...snapshot, reason: safeReason }
      : {
          repo,
          capturedAt: now(),
          records: [],
          reason: safeReason,
        };
    onSnapshot?.(snapshot);
  };

  const storeResult = (result: TicketSnapshot) => {
    if (result.reason !== undefined) {
      recordFailure(result.reason, result.repo);
      return;
    }
    if (snapshot && result.repo !== snapshot.repo) {
      recordFailure("repository changed");
      return;
    }
    snapshot = {
      repo: result.repo,
      capturedAt: now(),
      records: result.records,
    };
    onSnapshot?.(snapshot);
  };

  const settle = (
    timeoutHandle: NodeJS.Timeout,
    callback: () => void,
    timedOut: () => boolean,
  ) => {
    if (timedOut() || isStopped) {
      clearActiveTimeout(timeoutHandle);
      isInFlight = false;
      return;
    }
    try {
      callback();
    } catch {
      recordFailure("unavailable");
    } finally {
      clearActiveTimeout(timeoutHandle);
      isInFlight = false;
    }
  };

  /** Perform a single read with a bounded timeout. */
  function performRead() {
    if (isInFlight || isStopped) return;
    isInFlight = true;

    let timedOut = false;
    const timeoutHandle = setTimer(() => {
      if (timedOut || isStopped) return;
      timedOut = true;
      activeTimeout = undefined;
      recordFailure("timeout");
    }, readTimeoutMs);
    activeTimeout = timeoutHandle;
    unref(timeoutHandle);

    try {
      Promise.resolve(read()).then(
        (result) => {
          settle(
            timeoutHandle,
            () => {
              if (!isTicketSnapshot(result)) {
                recordFailure("invalid snapshot");
                return;
              }
              storeResult(result);
            },
            () => timedOut,
          );
        },
        (error) => {
          settle(
            timeoutHandle,
            () => recordFailure(reasonFrom(error)),
            () => timedOut,
          );
        },
      );
    } catch (error) {
      settle(
        timeoutHandle,
        () => recordFailure(reasonFrom(error)),
        () => timedOut,
      );
    }
  }

  /** Tick handler: skip a tick while a read is in flight. */
  function tick() {
    if (isStopped) return;
    if (!isInFlight) performRead();
    if (isStopped) return;
    timer = setTimer(tick, clampedInterval);
    unref(timer);
  }

  timer = setTimer(tick, clampedInterval);
  unref(timer);

  return {
    getSnapshot() {
      return snapshot;
    },

    stop() {
      isStopped = true;
      if (timer) {
        clearTimer(timer);
        timer = undefined;
      }
      if (activeTimeout) {
        clearTimer(activeTimeout);
        activeTimeout = undefined;
      }
    },
  };
}
