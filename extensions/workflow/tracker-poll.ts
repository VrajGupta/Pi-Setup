import type { TicketSnapshot } from "../shared/ticket-snapshot.ts";

/**
 * A fixed-interval poll of the tracker that runs off the render path.
 * Single-flight: at most one read is in flight at a time. Failed reads
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
  value: number | undefined,
  min: number,
  max: number,
  defaultValue: number,
): number {
  if (value === undefined || value === null || typeof value !== "number") {
    return defaultValue;
  }
  if (!Number.isFinite(value)) {
    return defaultValue;
  }
  return Math.max(min, Math.min(max, value));
}

/**
 * Start a fixed-interval off-render tracker poll.
 *
 * @param intervalMs - Polling interval, clamped to [2000, 300000], default 10000.
 * @param read - Async read function; resolves to a TicketSnapshot.
 * @param now - Injected clock for testing (returns epoch ms).
 * @param setTimer - Injected timer function for testing.
 * @returns Poll object with getSnapshot() and stop().
 */
export function startTrackerPoll({
  intervalMs,
  read,
  now,
  setTimer,
}: {
  intervalMs: number;
  read: () => Promise<TicketSnapshot>;
  now: () => number;
  setTimer: (callback: () => void, delayMs: number) => NodeJS.Timeout;
}): TrackerPoll {
  const clampedInterval = clampInterval(intervalMs, 2000, 300000, 10000);
  const readTimeoutMs = clampedInterval; // Timeout equals the interval

  let snapshot: TrackerPollSnapshot | undefined;
  let isInFlight = false;
  let timer: NodeJS.Timeout | undefined;
  let isStopped = false;

  /**
   * Perform a single read with bounded timeout using the injected setTimer.
   */
  function performRead(): void {
    if (isInFlight || isStopped) return;
    isInFlight = true;

    let completed = false;
    let timeoutFired = false;

    // Schedule a timeout using the injected timer
    const timeoutHandle = setTimer(() => {
      if (!completed && !timeoutFired) {
        timeoutFired = true;
        // Timeout occurred; preserve previous snapshot with reason.
        // Do NOT clear isInFlight here: single-flight (INV-13) means a new
        // read may start only after this read actually settles; otherwise a
        // slow read would overlap with the next tick.
        snapshot = snapshot
          ? {
              ...snapshot,
              reason: "timeout",
            }
          : {
              repo: "",
              capturedAt: now(),
              reason: "timeout",
            };
      }
    }, readTimeoutMs);

    // Start the read
    read()
      .then((result) => {
        if (!timeoutFired) {
          completed = true;
          clearTimeout(timeoutHandle);

          snapshot = {
            repo: result.repo,
            capturedAt: now(),
            records: result.records,
            reason: undefined,
          };
        }
        isInFlight = false;
      })
      .catch((error) => {
        if (!timeoutFired) {
          completed = true;
          clearTimeout(timeoutHandle);

          // Record the error reason
          const reason =
            error instanceof Error ? error.message : "unknown error";
          snapshot = snapshot
            ? {
                ...snapshot,
                reason,
              }
            : {
                repo: "",
                capturedAt: now(),
                reason,
              };
        }
        isInFlight = false;
      });
  }

  /**
   * Tick handler: check if we should read.
   */
  function tick(): void {
    if (isStopped) return;

    // Single-flight: skip this tick if a read is in flight
    if (!isInFlight) {
      performRead();
    }

    // Schedule the next tick
    if (!isStopped) {
      timer = setTimer(tick, clampedInterval);
      // Unref the timer so it doesn't keep the process alive
      if (timer && typeof (timer as NodeJS.Timer).unref === "function") {
        (timer as NodeJS.Timer).unref();
      }
    }
  }

  // Start the poll by scheduling the first tick
  timer = setTimer(tick, clampedInterval);
  if (timer && typeof (timer as NodeJS.Timer).unref === "function") {
    (timer as NodeJS.Timer).unref();
  }

  return {
    getSnapshot(): TrackerPollSnapshot | undefined {
      return snapshot;
    },

    stop(): void {
      isStopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
  };
}
