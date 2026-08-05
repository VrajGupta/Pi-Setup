import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { WorkflowMode } from "./src/policy.ts";

/**
 * Serialize concurrent writes so at most one persist is in-flight at a time.
 * Each call captures the previous call's promise before creating its own, then
 * waits for the previous write to complete before reading the file.  This
 * prevents two rapid /mode switches from racing (read → read → write → write)
 * where the last rename wins and the file and live mode diverge.
 */
let writeInProgress: Promise<void> = Promise.resolve();

/**
 * Validate a raw `workflow.mode` value from settings.
 * Returns the normalized mode and, when the persisted value was syntactically
 * invalid, a warning string (never containing the raw value — INV-2).
 */
export function validateWorkflowMode(raw: unknown): {
  mode: WorkflowMode;
  warning?: string;
} {
  if (raw === "workflow" || raw === "free") return { mode: raw };
  if (raw === undefined) return { mode: "workflow" };
  return {
    mode: "workflow",
    warning: "invalid persisted workflow.mode — defaulting to workflow",
  };
}

/**
 * Read workflow.mode from the settings file. Returns the mode or "workflow" if
 * the file is missing, unreadable, has no workflow.mode, or the value is not
 * "free" (INV-6: a throwing read must not crash startup).
 */
export async function readWorkflowMode(
  settingsPath?: string,
): Promise<WorkflowMode> {
  try {
    const path = settingsPath ?? join(getAgentDir(), "settings.json");
    const raw = await readFile(path, "utf8");
    const settings = JSON.parse(raw);
    if (typeof settings !== "object" || settings === null) return "workflow";
    const workflow = settings.workflow;
    return typeof workflow === "object" &&
      workflow !== null &&
      workflow.mode === "free"
      ? "free"
      : "workflow";
  } catch {
    return "workflow";
  }
}

/**
 * Persist workflow.mode to the settings file atomically.
 *
 * 1. Reads the current settings file.
 * 2. Merges `workflow.mode` into the parsed object, preserving every other key.
 * 3. Writes to a temp file, then renames over the target (atomic).
 * 4. On failure (read, parse, write, rename), the settings file is untouched
 *    and the function returns `false` so the caller degrades gracefully.
 *
 * Write operations are serialized so two rapid `/mode` switches cannot race
 * (INV-12: concurrent writes do not interleave into corruption).
 *
 * INV-10: never partial-write; preserve the full settings object.
 * INV-12: atomic, idempotent, minimal.
 */
export async function persistWorkflowMode(
  newMode: WorkflowMode,
  settingsPath?: string,
): Promise<boolean> {
  // Capture the previous write's promise before creating a new one, so a
  // concurrent call (e.g. Promise.all) waits for the previous write.
  const prevWrite = writeInProgress;
  let resolveWrite: (() => void) | undefined;
  writeInProgress = new Promise<void>((resolve) => {
    resolveWrite = resolve;
  });

  await prevWrite;

  let temporary: string | undefined;
  try {
    const path = settingsPath ?? join(getAgentDir(), "settings.json");
    temporary = `${path}.${process.pid}.${Date.now()}.tmp`;

    // Runtime guard: never write a non-normalized mode (INV-12).
    if (newMode !== "workflow" && newMode !== "free") {
      resolveWrite?.();
      return false;
    }

    const raw = await readFile(path, "utf8");
    const settings = JSON.parse(raw);
    if (typeof settings !== "object" || settings === null) {
      resolveWrite?.();
      return false;
    }
    const merged = {
      ...settings,
      workflow: { ...(settings.workflow ?? {}), mode: newMode },
    };
    await writeFile(temporary, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
    await rename(temporary, path);
    resolveWrite?.();
    return true;
  } catch {
    // Clean up the temp file if it exists; never swallow the original file.
    if (temporary) await rm(temporary, { force: true }).catch(() => {});
    // Unblock the next write so the queue is never stuck.
    resolveWrite?.();
    return false;
  }
}
