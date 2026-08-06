import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { normalizeMaxLines } from "./status-widget.ts";

/**
 * Resolve `workflow.statusWidget.maxLines` from a parsed settings object, off
 * the render path (PI-37). Missing, malformed, or non-object shapes normalize
 * to the default 40 (INV-6); `0` normalizes to the unlimited sentinel. The
 * render module itself never reads settings (INV-3).
 */
export function resolveStatusWidgetMaxLines(settings: unknown): number {
  try {
    if (typeof settings !== "object" || settings === null)
      return normalizeMaxLines(undefined);
    const workflow = (settings as Record<string, unknown>).workflow;
    if (typeof workflow !== "object" || workflow === null)
      return normalizeMaxLines(undefined);
    const statusWidget = (workflow as Record<string, unknown>).statusWidget;
    if (typeof statusWidget !== "object" || statusWidget === null)
      return normalizeMaxLines(undefined);
    return normalizeMaxLines(
      (statusWidget as Record<string, unknown>).maxLines,
    );
  } catch {
    return normalizeMaxLines(undefined);
  }
}

/**
 * Read `workflow.statusWidget.maxLines` from the agent settings file. An
 * unreadable or malformed file yields the default 40 and never throws
 * (INV-6). Called once per session by the widget factory, off the render path
 * (INV-3); a settings path is injectable for deterministic tests.
 */
export function readStatusWidgetMaxLines(settingsPath?: string): number {
  try {
    const path = settingsPath ?? join(getAgentDir(), "settings.json");
    return resolveStatusWidgetMaxLines(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return normalizeMaxLines(undefined);
  }
}
