# Spec — Down-arrow subagent picker + unbounded todo surface (PI-33 … PI-39)

Planner pass, 2026-08-06. Grilled with Vraj; all eight decisions locked below.
Branch base: `origin/main` @ `2f9a711`. Highest prior ticket: PI-32. Highest prior
invariant: INV-18 (`docs/2026-08-05-routines-spec.md`). New invariants here start at **INV-19**.

Two independent features share one planning pass because both land in the same two
extensions (`extensions/subagents`, `extensions/ui-customization`) and both touch the
INV-4 bounded-footprint family.

- **Feature A — down-arrow subagent picker.** Replicate Claude Code's "press DOWN while
  subagents are running to pick one and go into it" inside Pi.
- **Feature B — the whole todo list, unbounded.** Make the always-visible below-prompt
  issue list actually render, and remove its arbitrary line cap.

---

## 1. Runtime inventory (done before any decision was locked)

Read from the installed runtime, `@earendil-works/pi-coding-agent@0.82` /
`@earendil-works/pi-tui@0.82`. The extension API is the ceiling; these facts decide
Feature A's mechanism.

| Fact | Evidence |
| --- | --- |
| `pi.registerShortcut(key, handler)` is checked **first** in the editor's input path and **unconditionally swallows** a matching key — the handler cannot decline | `dist/modes/interactive/components/custom-editor.js:26` (`if (this.onExtensionShortcut?.(data)) return;`), wired at `dist/modes/interactive/interactive-mode.js:1400-1411` (returns `true` on `matchesKey`) |
| Therefore binding bare `down` via `registerShortcut` would permanently destroy stock DOWN: cursor-down, move-to-line-end, and prompt-history-forward | `pi-tui/dist/components/editor.js:678-689` (`tui.editor.cursorDown` → `navigateHistory(1)` \| `moveToLineEnd()` \| `moveCursor(1,0)`) |
| `ctx.ui.setEditorComponent(factory)` is the **only** API that permits a *conditional* key intercept | `dist/core/extensions/types.d.ts:171` |
| `CustomEditor` is a public export of `@earendil-works/pi-coding-agent`, so a subclass inherits every app-level binding | `dist/index.d.ts:28` |
| The runtime duck-type-detects a `CustomEditor` subclass and copies `onEscape`, `onCtrlD`, `onPasteImage`, `onExtensionShortcut`, every registered action handler, the autocomplete provider, `onSubmit`/`onChange`, text, border colour and padding onto it | `dist/modes/interactive/interactive-mode.js:1855-1895` |
| Terminal height is reachable as `tui.terminal.rows` from the widget factory (`ctx.ui.setWidget(name, (tui, theme) => …)`), i.e. **off** the pure render function | `pi-tui/dist/terminal.d.ts:25`; existing factory at `extensions/ui-customization/index.ts:241` |
| Chatting to a subagent **already exists and is Done** — PI-17's explicit stage-view send, guarded by PI-11's orchestrator-only rule. Feature A adds no new send path | `tickets.md` PI-17 (Done), PI-11 (Done) |
| The picker loop (`openSubagentPicker`) already returns to the dashboard after a takeover exits | `extensions/subagents/src/ui/takeover.ts:155-182` |
| **Live gap 1:** `ticketSnapshot` is declared but never assigned, so the below-prompt issues section renders **nothing** today | `extensions/ui-customization/index.ts:110`, `:288`; `status-widget.ts` comment "keeps the surface minimal until a snapshot source is wired in" |
| **Live gap 2:** `startTrackerPoll` (PI-22, Done) was never wired to a session lifecycle | PI-22 debugger note: "Tracker-poll wiring into the later status-surface lifecycle remains outside this lane" |
| **Live gap 3:** the widget is called with `maxLines: undefined`, so `workflow.statusWidget.maxLines` in `settings.example.json` is read by nothing | `extensions/ui-customization/index.ts:280` vs `settings.example.json:16-17` |
| The routines section (PI-31/PI-32) *does* publish through a channel — the exact pattern the ticket snapshot must follow | `extensions/ui-customization/index.ts:142-144` (`vraj:routines-snapshot`) |

Consequence: **"I want to see the whole to-do list" is currently showing zero rows.**
Feature B is first a wiring fix, only then a cap change.

---

## 2. Locked decisions (Vraj, 2026-08-06)

| # | Decision | Locked answer |
| --- | --- | --- |
| 1 | Scope of "in Claude Code" | Replicate the UX **inside Pi only**. Claude Code (closed-source, not a dependency) is untouched and out of scope. |
| 2 | Trigger mechanism | **Both.** (a) A guarded `CustomEditor` subclass gives true **bare DOWN**, intercepting only when *all* guards hold, else delegating to stock. (b) An **`alt+down`** `registerShortcut` alias that works regardless of buffer state. (c) Kill-switch setting `workflow.subagentPicker.downArrow`. |
| 3 | Trigger condition | Fires when **≥1 subagent has status `running`**. The picker then lists **all** subagents, running first, then done/failed. |
| 4 | Orchestrator-only boundary | Picker includes **fleet stage agents and helpers**. DOWN only **opens** a view; sending text still requires PI-17's explicit in-view send affordance. No ambient main-chat keystroke may reach a stage. |
| 5 | Round-trip | Escape from a subagent → back to the **picker**; escape from the picker → back to the **main session**. (Existing `openSubagentPicker` loop retained.) |
| 6 | Which surface is unbounded | The **belowEditor status surface**. The footer keeps its 7-line INV-4 cap, unchanged. Fix the `maxLines: undefined` bug. |
| 7 | Meaning of "zero limits" | `workflow.statusWidget.maxLines: 0` means **unlimited**; the surface is bounded only by **terminal height**, reserving rows for the editor and footer so the prompt is never pushed off-screen; overflow collapses into the existing `+N more · /flow` line. |
| 8 | Content of "the whole to-do list" | **This repo's tickets, active (non-done) statuses only**, listed as rows; done tickets counted in the header rule, not listed. Cross-repo stays in `/flow`. |

Explicitly rejected: binding bare `down` through `registerShortcut` (decision 2 — would
break navigation globally); lifting the footer's 7-line cap (decision 6); unlimited lines
with no terminal-height reservation (decision 7).

---

## 3. Invariants

### 3.1 Unchanged and load-bearing here

- **INV-2 no-secret** — every new row (subagent titles, ticket titles) is secret-scrubbed
  before display; reuse `redactSecrets`/`safeDisplayLine`.
- **INV-3 render is pure and fast** — `renderStatusWidget` stays a pure function. Terminal
  rows are captured in the widget **factory** (`tui.terminal.rows`) and passed in as state;
  the render function performs no I/O and never touches `tui`.
- **INV-4 (footer clause) — unchanged.** The footer stays ≤7 lines (3 base + ≤4 extension
  status lines). `footer.test.ts` bounds tests are **not** relaxed by this effort.
- **INV-6 degrade, never fabricate, never crash** — a throwing snapshot getter, a malformed
  row, or a bad terminal size degrades to base lines, never a crash.
- **INV-8 no new trust edge** — no new network hop, no new prompt route.
- **INV-10 off-render repo reads** — the ticket snapshot is produced by the existing
  off-render `startTrackerPoll`, carries `capturedAt`, and renders `unavailable — <reason>`
  when unreadable.
- **INV-11 no meaning by colour alone** — status, staleness, blocked, and the overflow line
  survive `NO_COLOR`.
- **INV-13 fixed-interval polling is single-flight and off-render** — the wiring in PI-33
  must not weaken it: unref'd timer, cleared on `session_shutdown`.

### 3.2 INV-4 (amended, second amendment) — belowEditor bound

Supersedes clause 3 of the first amendment in `docs/2026-08-05-below-editor-status-surface.md`.

1. **Width safety is absolute** (unchanged): `visibleWidth(line) <= width` for every line at
   every width, via `truncateToWidth`. No implicit wrapping.
2. **Line count is a deterministic function of the input counts** (unchanged), now including
   the routines section: `1 rule + 1 mode/route + 1 rail + A stage rows + 1 issues rule +
   I issue rows + routine lines [+ 1 overflow]`.
3. **`maxLines` is a configurable runaway guard with an explicit unlimited value.** Read from
   `workflow.statusWidget.maxLines`. `0` means **unlimited**. Any other value is clamped to
   `[8, 200]`. Absent or non-numeric yields the default **40**.
4. **Truncation never loses content** (unchanged): truncated values carry `…` and the full
   value stays reachable in `/flow`.

### 3.3 New invariants

- **INV-19 — the status surface never occludes the prompt.** However many lines the surface
  would deterministically emit, it emits at most `availableRows = max(0, terminalRows −
  reservedRows)`, where `reservedRows` covers the editor, the footer, and one spare row.
  This bound applies **in unlimited mode too** and takes precedence over `maxLines`. When the
  bound truncates, the last emitted line is exactly the overflow line `+N more · /flow` with
  `N` equal to the suppressed row count. When `availableRows` is below the minimum needed for
  the base lines plus an overflow line, the surface emits **nothing** rather than pushing the
  editor off-screen. `terminalRows` is captured outside render (INV-3) and a missing,
  non-finite, or non-positive value degrades to the `maxLines` behaviour alone, never to an
  unbounded emit.
- **INV-20 — the DOWN trigger never steals navigation and never sends.** The editor
  subclass intercepts DOWN only when **all** of: the editor buffer is empty; the autocomplete
  dropdown is closed; the editor is not mid-history-navigation; at least one subagent has
  status `running`; and `workflow.subagentPicker.downArrow` is not `false`. In every other
  state the key is delegated unchanged to the stock editor. With the kill-switch `false`
  there is **zero** interception. The trigger's only effect is to **open** the picker — no
  keystroke path (DOWN, `alt+down`, picker navigation, or takeover entry) may deliver text to
  any subagent; sending remains PI-17's explicit in-view send affordance. Extends PI-11 and
  INV-8.
- **INV-14 (extended) — render budget in unlimited mode.** The existing budget now also
  holds with `maxLines: 0`: rendering a 200-ticket snapshot plus 5 routines at width 120 in
  unlimited mode completes in under 50 ms wall-clock in the repo's normal local test run, and
  the render path allocates no timers, in-flight promises, or I/O handles.

---

## 4. Feature A design

```
DOWN (guarded)  ─┐
alt+down        ─┼──► openSubagentPicker(ctx, view)   ◄── /subagents (unchanged)
/subagents      ─┘         │
                           ├─ SubagentDashboard (all agents; running first, then done/failed)
                           │     up/down/j/k · enter = open · x = abort (helpers only) · esc = main session
                           └─ TakeoverView ── esc ──► back to picker (existing loop)
```

- **PI-33** puts the whole trigger decision in a pure module,
  `extensions/subagents/src/picker-trigger.ts`, so the guard is testable without a TUI:
  `shouldOpenPicker({ editorText, autocompleteOpen, historyActive, runningCount, enabled })`.
- **PI-34** is the thin, dumb wiring: a `CustomEditor` subclass whose `handleInput` asks the
  pure module and otherwise calls `super.handleInput(data)`, registered through
  `ctx.ui.setEditorComponent`, plus the `alt+down` `registerShortcut` alias. The subclass must
  chain any editor factory already installed by another extension rather than clobbering it.
- **PI-35** is ordering and round-trip inside the existing dashboard: running-first sort,
  finished agents still listed, escape semantics, and the INV-20 no-send regression.

`alt+down` is free **in the editor**: the only default that uses it is
`app.models.reorderDown`, which is scoped to the `/scoped-models` selector, not the prompt
(`keybindings.md`, "Scoped Models Selector"). `alt+up` is `app.message.dequeue`, so the alias
must be `alt+down` specifically. PI-34 asserts the alias does not shadow
`app.models.reorderDown` inside that selector.

## 5. Feature B design

```
session_start ──► startTrackerPoll (PI-22, exists)  ──emit──► vraj:ticket-snapshot
                    off-render · single-flight · unref'd                │
session_shutdown ─► stop()                                              ▼
                                          ui-customization widget state.ticketSnapshot
                                                                        │
   tui.terminal.rows (factory, off-render) ─────────► availableRows ────┤
   workflow.statusWidget.maxLines (settings, off-render) ─► maxLines ───┤
                                                                        ▼
                                              renderStatusWidget (pure)  → lines
```

- **PI-36** closes live gaps 1 and 2: publish the poll's snapshot on a channel exactly like
  `vraj:routines-snapshot`, consume it in the widget, start on `session_start`, stop on
  `session_shutdown`. This alone is what makes the todo list appear at all.
- **PI-37** closes live gap 3 and adds unlimited: resolve `maxLines` from settings, `0` =
  unlimited, everything else clamped `[8, 200]`, default 40.
- **PI-38** adds the INV-19 terminal-height bound so unlimited stays usable.
- **PI-39** is docs, settings, and the closing regression for both features.

Active statuses listed as rows are the existing `PIPELINE_ORDER`
(`planned`, `agent-ready`, `coding`, `debugger-ready`, `debugging`, `review-ready`,
`reviewing`); done tickets remain counted in the `─ issues · N active · M done ─` rule line
and are not listed (decision 8).

---

## 6. Slice order

```
PI-33 (pure trigger)  ─► PI-34 (editor wiring + alt+down) ─┐
PI-35 (picker ordering/round-trip) ────────────────────────┤
PI-36 (snapshot wiring)  ─► PI-37 (maxLines + unlimited) ─► PI-38 (height bound) ─┴─► PI-39 (docs + regression)
```

Agent Ready now: **PI-33, PI-35, PI-36, PI-37**. Planned (blocked): **PI-34, PI-38, PI-39**.

## 7. Out of scope

- Modifying Claude Code itself (decision 1).
- Lifting the footer's 7-line INV-4 cap (decision 6).
- Cross-repo rows in the belowEditor surface — stays in `/flow` (decision 8).
- Any new path that delivers main-chat input to a stage agent (PI-11, INV-20).
- Changing `extensions/shared/ticket-snapshot.ts`, which stays a read-only dependency.
