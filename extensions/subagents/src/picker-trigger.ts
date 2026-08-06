/**
 * PI-33 — pure DOWN-trigger policy for the subagent picker (INV-20).
 *
 * The single decision point for whether a bare DOWN keystroke opens the
 * subagent picker. Pure: no TUI import, no I/O, no rendering.
 *
 * INV-20 semantics: interception happens unless the kill-switch is exactly
 * `false`, so a missing `enabled` field fails open (`enabled !== false`)
 * rather than silently disabling the trigger.
 */

export interface PickerTriggerInput {
  readonly editorText: string;
  readonly autocompleteOpen: boolean;
  readonly historyActive: boolean;
  readonly runningCount: number;
  readonly enabled: boolean;
}

export interface SubagentPickerSettings {
  readonly workflow?: {
    readonly subagentPicker?: {
      readonly downArrow?: unknown;
    };
  };
}

export function shouldOpenPicker(input: unknown): boolean {
  if (typeof input !== "object" || input === null) return false;
  const state = input as Partial<PickerTriggerInput>;
  if (
    typeof state.runningCount !== "number" ||
    !Number.isFinite(state.runningCount)
  ) {
    return false;
  }
  return (
    state.editorText === "" &&
    state.autocompleteOpen === false &&
    state.historyActive === false &&
    state.runningCount >= 1 &&
    state.enabled !== false
  );
}

export function resolvePickerEnabled(
  settings?: SubagentPickerSettings | null,
): boolean {
  return settings?.workflow?.subagentPicker?.downArrow !== false;
}
