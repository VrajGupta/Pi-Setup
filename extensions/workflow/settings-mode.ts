import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { WorkflowMode } from "./src/policy.ts";

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
 * INV-10: never partial-write; preserve the full settings object.
 * INV-12: atomic, idempotent, minimal.
 */
export async function persistWorkflowMode(
  newMode: WorkflowMode,
  settingsPath?: string,
): Promise<boolean> {
  const path = settingsPath ?? join(getAgentDir(), "settings.json");
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    const raw = await readFile(path, "utf8");
    const settings = JSON.parse(raw);
    if (typeof settings !== "object" || settings === null) return false;
    const merged = {
      ...settings,
      workflow: { ...(settings.workflow ?? {}), mode: newMode },
    };
    await writeFile(temporary, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
    await rename(temporary, path);
    return true;
  } catch {
    // Clean up the temp file if it exists; never swallow the original file.
    await rm(temporary, { force: true }).catch(() => {});
    return false;
  }
}
