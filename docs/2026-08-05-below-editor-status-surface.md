# Spec — belowEditor status/control surface, rich issue rows, `/mode` UX

Date: 2026-08-05 · Stage: planner (plan) · Repo: `~/Work/pi-agent`
Tickets: **PI-20 … PI-26** · GitHub Project #12 (owner `VrajGupta`) · Repo issues in `VrajGupta/Pi-Setup`
Extends `docs/2026-08-04-flow-ui-and-token-savings.md` and `docs/2026-08-04-flow-todo-crossrepo-and-docs.md`. Nothing in either document is revoked.

---

## 1. State of the world (evidence, gathered before planning)

| Claim | Evidence |
| --- | --- |
| Working tree clean at plan start; HEAD `7adc185` | `git status --short` → empty; `git log --oneline -1` → `7adc185 docs(config): record approved model fallback map` |
| No belowEditor surface exists today | `grep -rn "setWidget\|belowEditor" extensions/` → no hits in this repo |
| The host API supports it | `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:42` → `type WidgetPlacement = "aboveEditor" \| "belowEditor"`; `:96-97` → `setWidget(key, string[] \| ((tui, theme) => Component), options)` |
| Native picker + argument completions exist | `types.d.ts:836` → `getArgumentCompletions?: (argumentPrefix) => AutocompleteItem[] \| null \| Promise<…>`; `docs/extensions.md` → `ctx.ui.select(prompt, options)` |
| All rich status is in the footer today, capped at 7 lines | `extensions/ui-customization/footer.ts:9,280-283` → `MAX_STAGE_ROWS = 4`, `const budget = 7 - base.length - rows.length` |
| Issue/todo rows exist only inside the `/flow` overlay | `extensions/workflow/index.ts:373-407` (`issueRow`, `repositoryList`), tab `"Issues"` at `:541` |
| `/mode` today is string-only and errors on bad input | `extensions/workflow/index.ts:1359-1374` → no picker, no completions, `ctx.ui.notify(…, "error")` |
| `/mode` today does **not** persist | `index.ts:1370-1372` sets the in-memory `mode` and publishes state; the only settings read is `modeFromSettings` at session start (`:1106-1109`, `:1472-1473`) |
| Tracker reads today are one-shot at session start, not polled | `refreshRepositoryView` is called only from `session_start` (`index.ts:1471`); there is no interval anywhere in `extensions/workflow` |
| Ticket parsing is already a pure, read-only module | `extensions/shared/ticket-snapshot.ts` exports `parseTicketSnapshot(tracker, capture)`; capture time is supplied by the off-render caller (`:250`) |
| Reusable terminal primitives already exist | `extensions/ui-customization/footer.ts:110` exports `columns`; `truncateToWidth` / `visibleWidth` from `@earendil-works/pi-tui`; theme via `theme.fg` |
| Theme ladder available | `themes/vraj-ink.json` → `text #e5f1ff`, `muted #8295ad`, `dim #52657d`, `accent`=cyan, `success`=mint, `warning`=amber, `error`=red, `borderMuted` |
| Project #12 Status field verified | `gh project field-list 12 --owner VrajGupta` → `Status` = `PVTSSF_lAHOCFvJwM4BfV__zhZpjbc`, option `Planned` = `f75ad846` |
| Last ticket is PI-19 (Done, issue #16) | `grep -n "^## PI-" tickets.md \| tail -1`; `gh issue list` → highest issue number 17 |

---

## 2. Locked decisions (user, 2026-08-05 — not planner defaults)

| # | Decision |
| --- | --- |
| q1 | The **belowEditor widget under the prompt is the primary status/control surface.** The footer stays for telemetry and the workflow rail where useful, but rich status moves below the prompt. |
| q2 | **No fixed line cap.** As many lines as needed to look good and show the most information — subject to deterministic width bounds, terminal readability, and render performance, and never runaway output. |
| q3 | Todo/issue content = **named issue numbers + status + mode + other useful info**, as rich rows. |
| q4 | Tracker refresh uses a **fixed polling interval**, off the render path. |
| q5 | `/mode` UX: **native picker on bare `/mode`**, completions for `workflow\|free`, invalid input → **warning** (never a red error), and a successful switch **updates the visible belowEditor widget/footer**. |
| q6 | **Every `/mode` switch persists** to settings (`workflow.mode`); the current mode must be unmistakable. |
| q7 | Labels are exactly `mode free (manual)` / `mode workflow` and `route direct` / `route fleet/<stage>`. |
| q8 | Layout may be as large and rich as needed; **width safety and terminal readability are required.** |

---

## 3. Invariants

### 3.1 Preserved unchanged

- **INV-1 measured-only telemetry.** No number is displayed that was not measured. Unknown stays unknown; a positive sub-1 % reading renders `<1%`, never `0%`.
- **INV-2 secret redaction.** No credential, header, token, or URL secret reaches any surface; the settings-write path mutates `workflow.mode` only.
- **INV-3 render path does no I/O and holds a perf budget.** Render is a pure function of already-captured data.
- **INV-5 staleness `~`.** Any reading older than its staleness window renders a leading `~` plus its age.
- **INV-6 throwing getters degrade to base output.** A malformed state, throwing accessor, or bad reading must never take the surface down.
- **INV-8 no new trust edge.** The mode picker is a closed two-option enum that mutates local routing only. It is **not** an input route to a stage; no `/mode` path may emit a spawn or send on the subagent bridge.
- **INV-10 off-render repo reads with capture timestamps.** Every tracker/git read happens outside render, is bounded, and carries a capture timestamp; an unreadable repo renders `unavailable` with a reason — never blank, never another repo's data, never stale-as-current.
- **INV-11 no meaning by colour alone.** Every status, staleness, mode, and blocked distinction is carried by text or an ASCII glyph that survives `NO_COLOR`/monochrome.
- `extensions/shared/ticket-snapshot.ts` is a **read-only dependency** of this effort. No ticket here modifies it.

### 3.2 INV-4, amended per q2

**INV-4 (amended) — bounded, not capped.** The 7-line footer cap continues to apply to the **footer**. The belowEditor status widget has **no fixed small line cap**; instead:

1. **Width safety is absolute.** Every emitted line satisfies `visibleWidth(line) <= width` for every width, via `truncateToWidth`. No line ever wraps implicitly.
2. **Line count is a deterministic function of the input counts**, not of content length: `lines = 1 rule + 1 mode/route + 1 rail + A stage rows + 1 issues rule + I issue rows [+ 1 overflow]`, where `A` = tracked stage agents and `I` = issue rows in the active window. Same input → same line count, every time.
3. **A hard runaway ceiling exists** — `maxLines`, default **40**, read from `workflow.statusWidget.maxLines` and clamped to `[8, 200]`. It is a runaway guard, not a design cap. When the deterministic count exceeds it, the surface emits exactly `maxLines` lines and the last line is the overflow line `+N more · /flow`, with `N` equal to the suppressed row count.
4. **Truncation never loses content.** A truncated value is marked with `…` and the full value stays reachable in `/flow` (Issues tab).

### 3.3 New invariants (testable; `/debugger` attacks these, `/reviewer` reviews them)

- **INV-12 mode persistence is atomic, idempotent, and minimal.** A `/mode` switch writes `workflow.mode` to the agent settings file through a temp-file-plus-rename, preserves every other key and value, is byte-identical when applied twice, and mutates no other field. A failed write never loses the live switch; it degrades honestly to `… · session only` and notifies at `warning`.
- **INV-13 fixed-interval polling is single-flight and off-render.** The tracker poll runs on a fixed interval read once from `workflow.trackerPollMs` (default 10000 ms, clamped `[2000, 300000]`). At most one read is in flight at a time; a tick during an in-flight read is skipped, not queued. Render consumes only the last *completed* snapshot and its `capturedAt`. A failed or timed-out read preserves the previous snapshot and records a reason. The timer is unref'd and cleared on `session_shutdown`.
- **INV-14 render budget is measured, not asserted.** Rendering the full surface for a 200-ticket snapshot completes in under 50 ms wall-clock in the repo's normal local test run, and the render path allocates no timers, promises-in-flight, or I/O handles.

---

## 4. Visual design (better-ui / better-typography / better-colors, expressed in terminal terms)

The app is a native Pi terminal TUI. There is no web CSS. The vocabulary is `columns()`, `truncateToWidth()`, `visibleWidth()`, `theme.fg()`, and glyphs.

### 4.1 Target layout

```
 ─ flow ─────────────────────────────────────────────────────────────
 mode workflow                                      route fleet/coder
 ✓ planner  →  ◉ coder  →  · debugger  →  · reviewer
 ◉ coder      opencodego/deepseek-v4-flash    4m12s    6t     7% ctx
 · debugger   waiting on helper                 8s     0t       ? ctx
 ─ issues · 4 active · 12 done · ~ 12s ───────────────────────────────
 PI-20  ready     coder     belowEditor status host…      blk none
 PI-21  coding    coder     rich mode/route/stage rows…   blk PI-20 ✓
 PI-23  planned   planner   issue rows in the widget…     blk PI-21 ·
 +6 more · /flow
```

### 4.2 Principles and how each is honoured

| Principle | Terminal expression |
| --- | --- |
| **Tabular numbers** (better-typography) | Every changing numeric cell — elapsed, turns, `% ctx`, ages — is right-aligned and padded to a column width computed once per render from the widest cell in that column. Digits never jitter as values change. Alignment is done with `visibleWidth`, never `String.length`. |
| **Truncation without losing content** | Text columns clip with `truncateToWidth` and an explicit `…`. The full ticket title, blocker list, and reason are always reachable in `/flow` → Issues. The widget states where the rest lives (`+N more · /flow`). |
| **Hierarchy via spacing and glyphs, not weight-only** | Section rules (`─ flow ─…`, `─ issues · … ─…`) in `borderMuted` separate blocks; the primary line (mode/route) sits directly under the rule; secondary rows are indented by one space. Bold is used for the mode value only. |
| **Contrast floor** (better-colors) | Only the existing `vraj-ink` ladder is used: primary values `text` (#e5f1ff), secondary `muted` (#8295ad), decoration `dim`/`borderMuted`. `dim` is never the sole carrier of a value — it is used for inactive stage glyphs that already carry a `·` marker. Semantic hues reuse `success`/`warning`/`error`/`accent` exactly as the footer does. |
| **No meaning by colour alone (INV-11)** | Status is always a word (`ready`, `coding`, `planned`, `blocked`, `unavailable`), staleness is always `~`, stage state is always a glyph (`✓` done, `◉` active, `·` idle, `×` error). Monochrome rendering loses nothing. |
| **Optical rhythm** | Two-space gutters between columns; one leading space on every line so the surface never abuts the terminal edge; blank separator lines are not used (they read as dead space below a prompt) — the rules do that job. |
| **Progressive disclosure** | Widget = the "what now" surface (mode, route, live stages, active issues). `/flow` = the full record (all tabs, all repos, full strings, capabilities, session). |

### 4.3 Degradation ladder by width

- `width >= 100`: full layout as above.
- `60 <= width < 100`: model/backend column drops from stage rows; issue title column absorbs the remainder.
- `width < 60`: issue rows collapse to `PI-nn status blk-summary`; the rail collapses to the active stage only.
- `width <= 0` or malformed: return `[]` — never throw (INV-6).

---

## 5. Architecture

```
extensions/ui-customization/status-widget.ts     NEW  pure render module (no imports of node:fs/child_process)
extensions/ui-customization/status-widget.test.ts NEW
extensions/ui-customization/index.ts             EDIT registers the belowEditor widget; footer deduplication
extensions/workflow/tracker-poll.ts              NEW  fixed-interval, single-flight, off-render poller
extensions/workflow/tracker-poll.test.ts         NEW
extensions/workflow/settings-mode.ts             NEW  atomic, minimal settings merge for workflow.mode
extensions/workflow/settings-mode.test.ts        NEW
extensions/workflow/mode-command.test.ts         NEW  picker / completions / warning / no-trust-edge
extensions/workflow/index.ts                     EDIT /mode picker + completions + persistence; poll wiring
extensions/shared/ticket-snapshot.ts             READ-ONLY dependency — not modified by any ticket here
settings.example.json, README.md, SYSTEM.md      EDIT documentation of the new surface and settings
```

Data flow: `tracker-poll` (interval, off render) → `TicketSnapshot` + `capturedAt` → widget state object → `renderStatusWidget(state, width)` (pure) → `ctx.ui.setWidget("vraj-status", …, { placement: "belowEditor" })`.

---

## 6. Dependency order

```
PI-20  belowEditor host + deterministic bounds        (no blockers)
  └─ PI-21  rich mode/route/stage rows                 (blocked-by PI-20)
       ├─ PI-23  rich issue/todo rows                  (blocked-by PI-21, PI-22)
       └─ PI-24  /mode picker + completions + warning  (blocked-by PI-21)
            └─ PI-25  persist workflow.mode            (blocked-by PI-24)
PI-22  fixed-interval off-render tracker poll          (no blockers; may run parallel to PI-20/PI-21)
PI-26  footer dedup + docs + bounds/perf regression    (blocked-by PI-23, PI-25)
```

PI-20 and PI-22 are the two parallel entry points. PI-26 is the closing gate.

---

## 7. Scope boundaries

- **No application code is written by this plan.** Planner produces the spec, the tickets, and the board rows only.
- `extensions/shared/ticket-snapshot.ts` is read-only for this effort. If a parser change appears necessary, that is a new ticket, not an in-place edit.
- The `/flow` overlay keeps every tab it has today. The widget adds a surface; it removes none.
- No ticket here changes routing semantics, authz, or data exposure. The mode still changes routing only (INV-8).
- Every ticket enters the board as `Planned`. Only `/reviewer` may move a ticket to `Done`.
- No push, tag, or release is authorized by this plan.

---

## 8. Handoff pointer

`docs/handoffs/2026-08-05-planner-pi20-pi26.md` — written at the end of this planning run; it carries the ticket table, the board read-backs, the invariant list, and the entry point for `/coder` (start at **PI-20** or **PI-22**).
