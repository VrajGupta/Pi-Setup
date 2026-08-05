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

function isPositiveNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

function isIntegerInRange(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
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

  // name — non-empty string
  if (!isNonEmptyString(raw.name)) {
    warnings.push(`routine at index ${index} has invalid name — skipped`);
    return null;
  }

  // Duplicate name: first-wins (INV-16)
  if (seenNames.has(raw.name)) {
    warnings.push(`routine at index ${index} has duplicate name — skipped`);
    return null;
  }

  // scheduleMs — positive number
  if (!isPositiveNumber(raw.scheduleMs)) {
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
    if (filtered.length > 0) {
      at = filtered;
    }
  }

  // prompt — non-empty string
  if (!isNonEmptyString(raw.prompt)) {
    warnings.push(`routine at index ${index} has invalid prompt — skipped`);
    return null;
  }

  // enabled — boolean, default true
  const enabled = typeof raw.enabled === "boolean" ? raw.enabled : true;

  seenNames.add(raw.name);
  return {
    name: raw.name,
    scheduleMs: raw.scheduleMs,
    ...(at ? { at } : {}),
    prompt: raw.prompt,
    enabled,
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

  const workflow = settings.workflow;
  if (!isObject(workflow)) {
    return { routines: [], warnings: [] };
  }

  const raw = workflow.routines;
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
  return obj;
}
