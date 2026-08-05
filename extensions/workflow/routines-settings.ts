/**
 * Routines definitions — read/write `workflow.routines` from a settings object.
 *
 * Pure in-memory module: no filesystem, network, or subprocess calls.
 * The caller (scheduler or lifecycle wiring) performs any I/O.
 *
 * INV-2: validation errors never echo raw values.
 * INV-6: read path never throws; malformed entries drop per-entry with warnings.
 * INV-10: write preserves every unrelated settings key.
 */

export interface RoutineDefinition {
  readonly name: string;
  readonly scheduleMs: number;
  readonly at?: readonly number[];
  readonly prompt: string;
  readonly enabled: boolean;
  readonly snoozedUntil?: number;
}

export interface ReadResult {
  readonly routines: readonly RoutineDefinition[];
  readonly warnings: readonly string[];
}

export interface WriteResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly settings?: Record<string, unknown>;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

const MIN_SCHEDULE_MS = 60_000;
const MAX_SCHEDULE_MS = 604_800_000;
const MAX_NAME_LENGTH = 40;
// Terminal-safe: alphanumeric, underscore, hyphen, dot only.
const SAFE_NAME_RE = /^[a-zA-Z0-9._-]+$/;

function isIntegerInRange(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}

/**
 * Clamp scheduleMs to [MIN_SCHEDULE_MS, MAX_SCHEDULE_MS].
 * Returns null (reject) for non-number, null, undefined.
 */
function clampScheduleMs(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  if (v < MIN_SCHEDULE_MS) return MIN_SCHEDULE_MS;
  if (v > MAX_SCHEDULE_MS) return MAX_SCHEDULE_MS;
  return v;
}

function isValidName(v: unknown): v is string {
  return (
    typeof v === "string" &&
    v.length > 0 &&
    v.length <= MAX_NAME_LENGTH &&
    SAFE_NAME_RE.test(v)
  );
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/**
 * Safely access a property on an object, returning undefined if the getter throws.
 * INV-6: a throwing getter must not crash the read path.
 */
function safeGet(obj: Record<string, unknown>, key: string): unknown {
  try {
    return obj[key];
  } catch {
    return undefined;
  }
}

/**
 * Validate a single raw routine entry.
 * Returns the validated RoutineDefinition or null (entry dropped).
 * Adds warnings for failures without echoing raw values (INV-2).
 */
function validateRoutine(
  raw: unknown,
  index: number,
  warnings: string[],
  seenNames: Set<string>,
): RoutineDefinition | null {
  if (!isObject(raw)) {
    warnings.push(`routine at index ${index} is not an object — skipped`);
    return null;
  }

  // name — non-empty, terminal-safe, <= 40 chars
  if (!isValidName(raw.name)) {
    warnings.push(`routine at index ${index} has invalid name — skipped`);
    return null;
  }

  // Duplicate name: first-wins (INV-16)
  if (seenNames.has(raw.name)) {
    warnings.push(`routine at index ${index} has duplicate name — skipped`);
    return null;
  }

  // scheduleMs — clamp to [MIN_SCHEDULE_MS, MAX_SCHEDULE_MS]
  const scheduleMs = clampScheduleMs(raw.scheduleMs);
  if (scheduleMs === null) {
    warnings.push(`routine at index ${index} has invalid scheduleMs — skipped`);
    return null;
  }

  // at — optional array of integers 0-1439
  let at: number[] | undefined;
  if (raw.at !== undefined) {
    if (!Array.isArray(raw.at)) {
      warnings.push(`routine at index ${index} has invalid "at" — skipped`);
      return null;
    }
    const filtered: number[] = [];
    for (const v of raw.at) {
      if (isIntegerInRange(v, 0, 1439)) {
        filtered.push(v);
      }
      // Invalid at values are silently dropped
    }
    // Deduplicate for consistency with the scheduler
    const deduped = [...new Set(filtered)];
    if (deduped.length > 0) {
      at = deduped;
    }
  }

  // prompt — non-empty string
  if (!isNonEmptyString(raw.prompt)) {
    warnings.push(`routine at index ${index} has invalid prompt — skipped`);
    return null;
  }

  // snoozedUntil — optional; finite positive number; null/absent → undefined; invalid → dropped with warning per-entry
  let snoozedUntil: number | undefined;
  if (raw.snoozedUntil !== undefined && raw.snoozedUntil !== null) {
    if (
      typeof raw.snoozedUntil === "number" &&
      Number.isFinite(raw.snoozedUntil) &&
      raw.snoozedUntil > 0
    ) {
      snoozedUntil = raw.snoozedUntil;
    } else {
      warnings.push(
        `routine at index ${index} has invalid snoozedUntil — dropped`,
      );
    }
  }

  // enabled — boolean, default true
  const enabled = typeof raw.enabled === "boolean" ? raw.enabled : true;

  seenNames.add(raw.name);
  return {
    name: raw.name,
    scheduleMs,
    ...(at ? { at } : {}),
    prompt: raw.prompt,
    enabled,
    ...(snoozedUntil !== undefined ? { snoozedUntil } : {}),
  };
}

/**
 * Read validated routines from a settings object.
 * Missing key → empty array, no warnings.
 * Malformed entries → dropped per-entry with warnings (INV-6).
 */
export function readRoutines(settings: Record<string, unknown>): ReadResult {
  if (!isObject(settings)) {
    return { routines: [], warnings: [] };
  }

  // INV-6: use safeGet so a throwing getter never crashes the read path.
  const workflow = safeGet(settings, "workflow");
  if (!isObject(workflow)) {
    return { routines: [], warnings: [] };
  }

  const raw = safeGet(workflow, "routines");
  if (!Array.isArray(raw)) {
    return { routines: [], warnings: [] };
  }

  const routines: RoutineDefinition[] = [];
  const warnings: string[] = [];
  const seenNames = new Set<string>();

  for (let i = 0; i < raw.length; i++) {
    const validated = validateRoutine(raw[i], i, warnings, seenNames);
    if (validated !== null) {
      routines.push(validated);
    }
  }

  return { routines, warnings };
}

/**
 * Write routines into a settings object, preserving every unrelated key (INV-10).
 * Returns the new settings object on success.
 * Returns `{ok: false, reason}` for non-object input (no throw).
 */
export function writeRoutines(
  routines: RoutineDefinition[],
  settings: Record<string, unknown>,
): WriteResult {
  if (!isObject(settings)) {
    return { ok: false, reason: "settings is not an object" };
  }

  const merged = {
    ...settings,
    workflow: {
      ...(isObject(settings.workflow) ? { ...settings.workflow } : {}),
      routines: routines.map(normalizeRoutine),
    },
  };

  return { ok: true, settings: merged };
}

function normalizeRoutine(r: RoutineDefinition): Record<string, unknown> {
  const obj: Record<string, unknown> = {
    name: r.name,
    scheduleMs: r.scheduleMs,
    prompt: r.prompt,
    enabled: r.enabled,
  };
  if (r.at && r.at.length > 0) {
    obj.at = [...r.at];
  }
  if (r.snoozedUntil !== undefined) {
    obj.snoozedUntil = r.snoozedUntil;
  }
  return obj;
}
