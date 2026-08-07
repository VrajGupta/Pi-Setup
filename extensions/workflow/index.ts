import { readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_ROUTINE_INTERVAL_MS,
  startRoutineScheduler,
  type RoutineDefinition as SchedulerRoutine,
  type RoutineScheduler,
} from "./routines-scheduler.ts";
import type { StatusWidgetRoutineRecord } from "../ui-customization/status-widget.ts";
import {
  isValidTicketSnapshot,
  parseTicketSnapshot,
  type TicketSnapshot,
} from "../shared/ticket-snapshot.ts";
import {
  readRoutines,
  writeRoutines,
  type RoutineDefinition,
} from "./routines-settings.ts";
import { startTrackerPoll, type TrackerPoll } from "./tracker-poll.ts";

const REASONING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
const CAPABILITY_CHANNEL = "vraj:capability-used";
const CONTROL_MESSAGE_TYPE = "subagent-result";

function preview(text: string, max = 160) {
  const flat = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** One bounded, read-only tracker read for a declared repository. */
export interface RepositoryRead {
  readonly path: string;
  readonly repo: string;
  readonly capturedAt: number;
  readonly snapshot?: TicketSnapshot;
  readonly reason?: string;
}

export interface RepositoryView {
  readonly defaulted: boolean;
  readonly reads: readonly RepositoryRead[];
}

const OSC_PATTERN =
  /(?:\u001b\]|\u009d)(?:[^\u0007\u001b\u009c]|\u001b(?!\\))*(?:\u0007|\u001b\\|\u009c)/g;
// eslint-disable-next-line no-control-regex
const CSI_PATTERN = /(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]/g;
// eslint-disable-next-line no-control-regex
const ESCAPE_PATTERN = /\u001b(?:[()][0-2A-Z]|[ -/]*[@-~])/g;
// Header values are opaque display data: do not inspect quote or delimiter
// structure. Folded continuation lines belong to the preceding header; stop at
// the next non-indented line or another sensitive header.
const SENSITIVE_HEADER_PATTERN =
  /\b(Authorization|Cookie)[ \t]*:[ \t]*[^\r\n]*?(?:\r?\n[ \t]+[^\r\n]*?)*(?=\r?\n(?![ \t])|[ \t]+\b(?:Authorization|Cookie)[ \t]*:|$)/gi;
const SECRET_ASSIGNMENT_PATTERN =
  /(["']?(?:api[_-]?key|access[_-]?key|access[_-]?token|aws[_-]?access[_-]?key[_-]?id|authorization|cookie|credential|key|password|passwd|private[_-]?key|secret|token|[a-z][a-z0-9_-]*[_-](?:key|token|secret|password|passwd|credential|url|uri)(?:[_-][a-z0-9]+)?)["']?\s*[:=]\s*)(?:"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|["'][^\r\n]*|[^\s,;}]+)/gi;
const URI_PATTERN = /\b[a-z][a-z0-9+.-]*:\/{1,2}[^\s]+/gi;
const ROOTLESS_CREDENTIAL_URI_PATTERN =
  /\b[a-z][a-z0-9+.-]*:[^/\s:@]+:[^@\s]+@[^\s]+/gi;

function stringify(value: unknown, fallback = "") {
  try {
    return value === undefined || value === null ? fallback : String(value);
  } catch {
    return fallback;
  }
}

function redactSecrets(text: string) {
  return text
    .replace(SENSITIVE_HEADER_PATTERN, "$1: [REDACTED]")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [REDACTED]")
    .replace(
      /\b(sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,})\b/g,
      "[REDACTED]",
    )
    .replace(SECRET_ASSIGNMENT_PATTERN, "$1[REDACTED]")
    .replace(
      /([?&](?:api[_-]?key|access[_-]?token|key|secret|token)=)[^&#\s]+/gi,
      "$1[REDACTED]",
    )
    .replace(ROOTLESS_CREDENTIAL_URI_PATTERN, "[URL]")
    .replace(URI_PATTERN, "[URL]");
}

function displayText(value: unknown, fallback = "") {
  const clean = stringify(value, fallback)
    .replace(OSC_PATTERN, "")
    .replace(CSI_PATTERN, "")
    .replace(ESCAPE_PATTERN, "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "");
  return redactSecrets(clean)
    .replace(/\r\n?|\n|\t/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\bhttps?:\/\/[^\s]+/gi, "[URL]");
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function safeElapsed(now: unknown, startedAt: unknown) {
  const safeNow = finiteNumber(now);
  const safeStartedAt = finiteNumber(startedAt);
  return safeNow === undefined || safeStartedAt === undefined
    ? 0
    : Math.max(0, safeNow - safeStartedAt);
}

function safeTurns(value: unknown) {
  const turns = finiteNumber(value);
  return turns === undefined || turns < 0 ? 0 : Math.floor(turns);
}

function normalizeWidth(width: unknown) {
  if (typeof width !== "number" || !Number.isFinite(width)) return 0;
  return Math.max(0, Math.floor(width));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readTimestamp(
  getter: (() => number | undefined) | undefined,
  fallback: number,
) {
  try {
    const value = getter?.();
    return finiteNumber(value) ?? fallback;
  } catch {
    return fallback;
  }
}

function isTicketSnapshot(value: unknown): value is TicketSnapshot {
  return isValidTicketSnapshot(value);
}

function formatMinutesOfDay(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

function scheduleSummary(routine: RoutineDefinition) {
  const at = Array.isArray(routine.at)
    ? routine.at.filter((v) => typeof v === "number" && Number.isFinite(v))
    : [];
  if (at.length > 0)
    return `daily at ${at.map((v) => formatMinutesOfDay(v)).join(", ")}`;
  const minutes = Math.round((finiteNumber(routine.scheduleMs) ?? 0) / 60_000);
  if (minutes < 60) return `every ${minutes}m`;
  return `every ${Math.floor(minutes / 60)}h`;
}

function isRepositoryRead(value: unknown): value is RepositoryRead {
  if (
    !isRecord(value) ||
    typeof value.path !== "string" ||
    typeof value.repo !== "string" ||
    finiteNumber(value.capturedAt) === undefined
  ) {
    return false;
  }
  const hasSnapshot = value.snapshot !== undefined;
  const hasReason = value.reason !== undefined;
  if (hasSnapshot === hasReason) return false;
  if (hasReason && typeof value.reason !== "string") return false;
  return (
    !hasSnapshot ||
    (isTicketSnapshot(value.snapshot) && value.snapshot.repo === value.repo)
  );
}

function normalizeRepositoryRead(value: unknown): RepositoryRead {
  if (isRepositoryRead(value)) return value;
  const fallback = isRecord(value) ? value : {};
  return {
    path: typeof fallback.path === "string" ? fallback.path : "",
    repo: typeof fallback.repo === "string" ? fallback.repo : "?",
    capturedAt: finiteNumber(fallback.capturedAt) ?? 0,
    reason: "invalid snapshot",
  };
}

// The registry is declared in settings only; there is deliberately no
// directory scan, glob, or auto-discovery of repositories here.
export function resolveRepositories(
  settings: unknown,
  fallback: string,
): { readonly defaulted: boolean; readonly paths: readonly string[] } {
  const workflow = isRecord(settings) ? settings.workflow : undefined;
  const raw = isRecord(workflow) ? workflow.repositories : undefined;
  if (
    Array.isArray(raw) &&
    raw.length > 0 &&
    raw.every((entry) => typeof entry === "string" && entry.trim().length > 0)
  ) {
    return {
      defaulted: false,
      paths: [
        ...new Set(
          raw.map((entry) => {
            const path = entry.trim();
            if (path === "~") return homedir();
            if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
            return resolve(fallback, path);
          }),
        ),
      ],
    };
  }
  return { defaulted: true, paths: [fallback] };
}

const REPOSITORY_READ_TIMEOUT = Symbol("repository read timed out");
const REPOSITORY_STALENESS_MS = 30_000;

export interface RepositoryReadOptions {
  readonly readTracker?: (path: string) => Promise<string>;
  readonly timeoutMs?: number;
  readonly now?: () => number;
}

/** Bounded, read-only tracker read for one declared repository (off render). */
export async function readRepositoryTracker(
  declaredPath: string,
  options: RepositoryReadOptions = {},
): Promise<RepositoryRead> {
  const readTracker =
    options.readTracker ?? ((path: string) => readFile(path, "utf8"));
  const requestedTimeout = finiteNumber(options.timeoutMs);
  const timeoutMs =
    requestedTimeout === undefined || requestedTimeout <= 0
      ? 2_000
      : Math.min(requestedTimeout, 2_000);
  const now = options.now ?? Date.now;
  const path =
    declaredPath === "~"
      ? homedir()
      : declaredPath.startsWith("~/")
        ? resolve(homedir(), declaredPath.slice(2))
        : resolve(declaredPath);
  const base = {
    path,
    repo: basename(path),
    capturedAt: finiteNumber(now()) ?? Date.now(),
  };
  let tracker: string;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    tracker = await Promise.race([
      Promise.resolve().then(() => readTracker(join(path, "tickets.md"))),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(REPOSITORY_READ_TIMEOUT), timeoutMs);
      }),
    ]);
  } catch (error) {
    if (error === REPOSITORY_READ_TIMEOUT)
      return { ...base, reason: "timeout" };
    if (isRecord(error) && error.code === "ENOENT")
      return { ...base, reason: "no tracker" };
    return { ...base, reason: "unreadable" };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  try {
    const snapshot = parseTicketSnapshot(tracker, {
      repo: base.repo,
      capturedAt: base.capturedAt,
    });
    if (snapshot.reason !== undefined)
      return { ...base, reason: snapshot.reason };
    return { ...base, snapshot };
  } catch {
    return { ...base, reason: "unreadable" };
  }
}

/** Map one bounded repository read to the poll's snapshot shape (PI-36). */
export async function readTrackerSnapshotForPoll(
  path: string,
): Promise<TicketSnapshot> {
  const read = await readRepositoryTracker(path);
  if (read.snapshot !== undefined) {
    return {
      repo: read.repo,
      capturedAt: read.capturedAt,
      records: read.snapshot.records,
    };
  }
  return {
    repo: read.repo,
    capturedAt: read.capturedAt,
    records: [],
    reason: read.reason ?? "unreadable",
  };
}

export interface TrackerPollLifecycleOptions {
  readonly read?: () => Promise<TicketSnapshot>;
  readonly now?: () => number;
  readonly setTimer?: (callback: () => void, delayMs: number) => NodeJS.Timeout;
  readonly clearTimer?: (handle: NodeJS.Timeout) => void;
}

/**
 * Start the off-render tracker poll for the belowEditor issue list (PI-36).
 * Resolves `workflow.trackerPollMs` (clamped by the poll, INV-13) and the
 * first declared repository from settings; every completed snapshot is emitted
 * on TICKET_SNAPSHOT_CHANNEL. Clock/timer/read are injectable for tests; the
 * production path uses the real clock, unref'd timers, and the bounded read.
 */
export function startTrackerPolling(
  pi: Pick<ExtensionAPI, "events">,
  settings: unknown,
  cwd: string,
  options: TrackerPollLifecycleOptions = {},
): TrackerPoll {
  const workflow = isRecord(settings) ? settings.workflow : undefined;
  const intervalMs = isRecord(workflow) ? workflow.trackerPollMs : undefined;
  const paths = resolveRepositories(settings, cwd).paths;
  const path = paths.length > 0 ? paths[0] : cwd;
  const now = options.now ?? Date.now;
  const setTimer =
    options.setTimer ??
    ((callback: () => void, delay: number) => setTimeout(callback, delay));
  const clearTimer =
    options.clearTimer ?? ((handle: NodeJS.Timeout) => clearTimeout(handle));
  return startTrackerPoll({
    intervalMs,
    read: options.read ?? (() => readTrackerSnapshotForPoll(path)),
    now,
    setTimer,
    clearTimer,
    onSnapshot: (snapshot) => {
      pi.events.emit(TICKET_SNAPSHOT_CHANNEL, snapshot);
    },
  });
}

export type RoutineCommandOutcome =
  | { kind: "pick" }
  | { kind: "run"; name: string }
  | { kind: "snooze"; name: string; minutes: number }
  | { kind: "disable"; name: string }
  | { kind: "enable"; name: string }
  | { kind: "warn"; message: string };

const DEFAULT_SNOOZE_MINUTES = 60;
const MAX_SNOOZE_MINUTES = 10080;

/** Parse a snooze minutes argument; absent defaults to 60, out-of-range clamps. */
function parseSnoozeMinutes(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return DEFAULT_SNOOZE_MINUTES;
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return null;
  return Math.min(MAX_SNOOZE_MINUTES, n);
}

/** Quiet due-routine banner (q3). Terminal-safe; never auto-runs (INV-8). */
export function routineBanner(name: string): string {
  const safe = displayText(name).trim() || "?";
  return `routine ${safe} due — /routine run ${safe} · /routine snooze ${safe} [min] · /routine disable ${safe} · dismiss`;
}

/** Parse a raw `/routine` argument string into a command outcome. */
export function normalizeRoutineCommand(value: string): RoutineCommandOutcome {
  const trimmed = value.trim();
  if (!trimmed) return { kind: "pick" };
  const parts = trimmed.split(/\s+/);
  const [sub, rest, extra] = parts;
  const lowered = sub.toLowerCase();
  if (lowered === "run") {
    if (!rest || !rest.trim())
      return { kind: "warn", message: "usage: /routine run <name>" };
    return { kind: "run", name: rest };
  }
  if (lowered === "snooze") {
    if (!rest || !rest.trim())
      return {
        kind: "warn",
        message: "usage: /routine snooze <name> [minutes]",
      };
    const minutes = parseSnoozeMinutes(extra);
    if (minutes === null)
      return {
        kind: "warn",
        message: `invalid minutes "${extra}" — use a whole number from 1 to 10080`,
      };
    return { kind: "snooze", name: rest, minutes };
  }
  if (lowered === "disable") {
    if (!rest || !rest.trim())
      return { kind: "warn", message: "usage: /routine disable <name>" };
    return { kind: "disable", name: rest };
  }
  if (lowered === "enable") {
    if (!rest || !rest.trim())
      return { kind: "warn", message: "usage: /routine enable <name>" };
    return { kind: "enable", name: rest };
  }
  return {
    kind: "warn",
    message: `unknown routine "${sub}" — use /flow to list routines`,
  };
}

/** Apply a persisted update (snooze/disable/enable) to one routine by name. */
export function applyRoutineUpdate(
  routines: readonly RoutineDefinition[],
  name: string,
  update: { snoozedUntil?: number; enabled?: boolean },
): { ok: boolean; routines?: readonly RoutineDefinition[] } {
  const index = routines.findIndex((r) => r.name === name);
  if (index < 0) return { ok: false };
  const next = routines.map((r, i) => (i === index ? { ...r, ...update } : r));
  return { ok: true, routines: next };
}

/** Argument completions for `/routine` mirroring the configured routine names. */
export function routineCompletions(
  routines: readonly RoutineDefinition[],
): { value: string; label: string }[] {
  return routines.map((r) => ({ value: r.name, label: r.name }));
}

/** Persist a full settings object atomically (temp-file + rename, INV-12). */
async function persistSettingsFile(
  settings: Record<string, unknown>,
): Promise<boolean> {
  try {
    const path = join(getAgentDir(), "settings.json");
    const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(
      temporary,
      `${JSON.stringify(settings, null, 2)}\n`,
      "utf8",
    );
    await rename(temporary, path);
    return true;
  } catch {
    return false;
  }
}

export const ROUTINES_SNAPSHOT_CHANNEL = "vraj:routines-snapshot";

// The ticket snapshot channel carries each completed off-render tracker poll
// read from the workflow extension to the belowEditor widget (PI-36, INV-10).
export const TICKET_SNAPSHOT_CHANNEL = "vraj:ticket-snapshot";

/**
 * Build the read-only widget summary for every configured routine from the
 * scheduler's snapshot (INV-10: off-render producer never writes; the widget
 * only reads). `dueAt` is the last-due time for a due routine, the snooze
 * release time for a snoozed routine, or an estimated next-due otherwise.
 */
export function buildRoutinesSnapshot(
  scheduler: RoutineScheduler,
  routines: readonly RoutineDefinition[],
  now: number,
): readonly StatusWidgetRoutineRecord[] {
  const stateByName = new Map(
    scheduler.getSnapshot().routines.map((r) => [r.name, r]),
  );
  const records: StatusWidgetRoutineRecord[] = [];
  for (const def of routines) {
    if (def === null || typeof def !== "object") continue;
    const st = stateByName.get(def.name);
    const enabled = def.enabled !== false;
    const snoozedUntil = finiteNumber(def.snoozedUntil);
    let dueAt: number;
    if (st?.isDue) {
      dueAt = now;
    } else if (snoozedUntil !== undefined && snoozedUntil > now) {
      dueAt = snoozedUntil;
    } else {
      const last = finiteNumber(st?.lastFiredAt);
      const interval = finiteNumber(def.scheduleMs);
      dueAt =
        last !== undefined && interval !== undefined
          ? last + interval
          : now + (interval ?? DEFAULT_ROUTINE_INTERVAL_MS);
    }
    records.push({
      name: def.name,
      schedule: scheduleSummary(def),
      enabled,
      ...(snoozedUntil !== undefined ? { snoozedUntil } : {}),
      dueAt,
    });
  }
  return records;
}

export interface RoutinesLifecycleOptions {
  readonly now?: () => number;
  readonly setTimer?: (callback: () => void, delayMs: number) => NodeJS.Timeout;
  readonly clearTimer?: (handle: NodeJS.Timeout) => void;
  readonly onSnapshot?: (
    snapshot: readonly StatusWidgetRoutineRecord[],
  ) => void;
  readonly onDue?: (routine: SchedulerRoutine) => void | Promise<void>;
}

export interface RoutinesLifecycle {
  /** Start (or restart) the scheduler from a routine list; emits a snapshot. */
  start(routines: readonly RoutineDefinition[]): void;
  /** Stop the scheduler and clear state; emits an empty snapshot. */
  stop(): void;
  /** Alias of start — reflects a settings change into the running scheduler. */
  refresh(routines: readonly RoutineDefinition[]): void;
  /** Off-render widget summary at an optional timestamp. */
  snapshot(now?: number): readonly StatusWidgetRoutineRecord[];
}

/**
 * Minimal scheduler lifecycle with injected timers/clock (mirrors
 * tracker-poll/routines-scheduler). A settings refresh restarts the scheduler
 * (stop clears the old timer, so there is no leak, INV-18) and recomputes
 * next-due from the updated definitions. No routines → idle, no timer.
 */
export function createRoutinesLifecycle(
  options: RoutinesLifecycleOptions = {},
): RoutinesLifecycle {
  const clock = options.now ?? Date.now;
  const setTimer =
    options.setTimer ??
    ((callback: () => void, delay: number) => setTimeout(callback, delay));
  const clearTimer =
    options.clearTimer ?? ((handle: NodeJS.Timeout) => clearTimeout(handle));
  let scheduler: RoutineScheduler | undefined;
  let routines: readonly RoutineDefinition[] = [];

  const emit = () => {
    const snapshot = scheduler
      ? buildRoutinesSnapshot(scheduler, routines, clock())
      : [];
    options.onSnapshot?.(snapshot);
  };
  const stop = () => {
    scheduler?.stop();
    scheduler = undefined;
    routines = [];
    options.onSnapshot?.([]);
  };
  const start = (next: readonly RoutineDefinition[]) => {
    stop();
    routines = next;
    if (next.length === 0) {
      options.onSnapshot?.([]);
      return;
    }
    scheduler = startRoutineScheduler({
      routines: next,
      now: clock,
      setTimer,
      clearTimer,
      onDue: (routine) => {
        options.onDue?.(routine);
        emit();
      },
    });
    emit();
  };
  return {
    start,
    stop,
    refresh: start,
    snapshot(ts = clock()) {
      return scheduler ? buildRoutinesSnapshot(scheduler, routines, ts) : [];
    },
  };
}

export default function workflow(pi: ExtensionAPI) {
  let context: ExtensionContext | undefined;
  let configuredRoutines: readonly RoutineDefinition[] = [];
  let routinesLifecycle: RoutinesLifecycle | undefined;
  let trackerPoll: TrackerPoll | undefined;

  const readGlobalSettings = async (): Promise<unknown> => {
    try {
      return JSON.parse(
        await readFile(join(getAgentDir(), "settings.json"), "utf8"),
      );
    } catch {
      return undefined;
    }
  };

  // A routine is a saved prompt the user asked to be reminded about. It is
  // surfaced, never auto-routed to a stage and never auto-sent to the agent.
  const runRoutine = async (
    routine: RoutineDefinition,
    ctx: ExtensionContext,
  ) => {
    ctx.ui.notify(
      `routine ${routine.name} · ${preview(routine.prompt)}`,
      "info",
    );
  };

  const startRoutineLifecycle = () => {
    routinesLifecycle?.stop();
    routinesLifecycle = createRoutinesLifecycle({
      now: Date.now,
      setTimer: (callback, delay) => setTimeout(callback, delay),
      clearTimer: (handle) => clearTimeout(handle),
      onSnapshot: (snapshot) => {
        pi.events.emit(ROUTINES_SNAPSHOT_CHANNEL, [...snapshot]);
      },
      onDue: (routine) => {
        context?.ui.notify(routineBanner(routine.name), "info");
      },
    });
    routinesLifecycle.start(configuredRoutines);
  };

  pi.registerCommand("routine", {
    description: "Run, snooze, disable, or enable a routine",
    getArgumentCompletions: (prefix: string) => {
      if (!prefix) return routineCompletions(configuredRoutines);
      const lower = prefix.toLowerCase();
      return routineCompletions(configuredRoutines).filter((item) =>
        item.value.toLowerCase().startsWith(lower),
      );
    },
    handler: async (args, ctx) => {
      const outcome = normalizeRoutineCommand(
        typeof args === "string" ? args : "",
      );
      if (outcome.kind === "warn") {
        ctx.ui.notify(outcome.message, "warning");
        return;
      }
      const settings = await readGlobalSettings();
      const base = isRecord(settings) ? settings : {};
      const { routines: raw } = readRoutines(base);
      const routines = [...raw];
      configuredRoutines = routines;
      if (outcome.kind === "pick") {
        const available = routines.filter(
          (r) =>
            r.enabled &&
            (r.snoozedUntil === undefined || r.snoozedUntil <= Date.now()),
        );
        if (available.length === 0) {
          ctx.ui.notify(
            "no routines configured — add workflow.routines to settings.json",
            "info",
          );
          return;
        }
        const choice = await ctx.ui.select(
          "Routine",
          available.map((r) => r.name),
        );
        if (!choice) return;
        const routine = available.find((r) => r.name === choice);
        if (routine) await runRoutine(routine, ctx);
        return;
      }
      if (outcome.kind === "run") {
        const routine = routines.find((r) => r.name === outcome.name);
        if (!routine) {
          ctx.ui.notify(
            `unknown routine "${outcome.name}" — use /routine to list routines`,
            "warning",
          );
          return;
        }
        await runRoutine(routine, ctx);
        return;
      }
      const update =
        outcome.kind === "snooze"
          ? { snoozedUntil: Date.now() + outcome.minutes * 60_000 }
          : outcome.kind === "disable"
            ? { enabled: false }
            : { enabled: true };
      const result = applyRoutineUpdate(routines, outcome.name, update);
      if (!result.ok || result.routines === undefined) {
        ctx.ui.notify(
          `unknown routine "${outcome.name}" — use /routine to list routines`,
          "warning",
        );
        return;
      }
      const merged = writeRoutines([...result.routines], base);
      if (!merged.ok || merged.settings === undefined) {
        ctx.ui.notify("routine change not persisted", "warning");
        return;
      }
      const persisted = await persistSettingsFile(merged.settings);
      configuredRoutines = [...result.routines];
      routinesLifecycle?.refresh(configuredRoutines);
      const label =
        outcome.kind === "snooze"
          ? `snoozed for ${outcome.minutes}m`
          : outcome.kind === "disable"
            ? "disabled"
            : "enabled";
      ctx.ui.notify(
        persisted
          ? `routine ${outcome.name} ${label}`
          : `routine ${outcome.name} ${label} · session only`,
        persisted ? "info" : "warning",
      );
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    context = ctx;
    const settings = await readGlobalSettings();
    configuredRoutines = readRoutines(
      isRecord(settings) ? settings : {},
    ).routines;
    startRoutineLifecycle();
    trackerPoll?.stop();
    trackerPoll = startTrackerPolling(pi, settings, ctx.cwd);
  });

  pi.on("session_shutdown", () => {
    routinesLifecycle?.stop();
    routinesLifecycle = undefined;
    trackerPoll?.stop();
    trackerPoll = undefined;
    context = undefined;
  });
}
