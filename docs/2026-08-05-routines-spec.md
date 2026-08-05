# Spec — Routines: periodic scheduled prompts/tasks (like Claude Code routines)

Date: 2026-08-05 · Stage: planner (plan) · Repo: `~/Work/pi-agent`
Tickets: **PI-28 … PI-32** · GitHub Project #12 (owner `VrajGupta`) · Repo issues in `VrajGupta/Pi-Setup`
Extends `docs/2026-08-05-below-editor-status-surface.md` (PI-20..PI-26). Nothing in that document is revoked.

---

## 1. State of the world (evidence, gathered before planning)

| Claim | Evidence |
| --- | --- |
| Working tree clean at plan start; HEAD `a47d7b1` | `git status --short` → empty; `git log --oneline -1` → `a47d7b1 docs(tracker): PI-26 Done; UI surface effort complete` |
| Remote `origin/main` matches HEAD | `git rev-parse HEAD` → `a47d7b1…`; `git ls-remote --heads origin main` → `a47d7b1…` |
| belowEditor status surface exists and is final | PI-20..PI-26 all Done; `extensions/ui-customization/status-widget.ts` is registered |
| Off-render tracker poll exists | `extensions/workflow/tracker-poll.ts` — single-flight, injectable timers, unref'd interval |
| Settings persistence pattern exists | `extensions/workflow/settings-mode.ts` — atomic read→merge→temp-write→rename |
| No routines system exists today | `grep -rn "routine\|routines\|scheduler" extensions/` → no hits |
| `/mode` picker + completions exist | `extensions/workflow/index.ts` — `/mode` bare picker, `getArgumentCompletions`, warning-on-invalid |
| Last PI number is PI-27 | `tickets.md` — PI-27 is the last entry; issue #25 is the last issue |
| Next available GitHub issue number | `gh issue list --state all --json number` → max 25, so next is 26 |
| PI-27's blocker PI-26 is Done | Project #12 read-back: PI-26 (`PVTI_lAHOCFvJwM4BfV__zg1Y1Qk`) status `Done` |
| `tracker-poll.ts` injectable-timer pattern | `startTrackerPoll({ intervalMs, read, now, setTimer, clearTimer })` — deterministic fake-clock tests |

---

## 2. Locked decisions (all `[locked by planner default]` — autonomous run, no human available)

### q1: Schedule model — fixed-interval with optional `at` minutes-of-day list

**Default:** Fixed-interval (`intervalMs: number`) with an optional `at` property (`at: number[]` — minutes of day, 0–1439) for time-of-day pinning. No full cron. [locked by planner default]

**Rationale:** The three named use cases are "daily standup, weekly review, hourly check" — all fixed-interval or fixed-time-of-day patterns. A full cron parser (5-field, DST, day-of-week, month) would handle these but adds complexity (parser, validation, timezone edge cases) for no benefit. An interval-based scheduler with an optional `at` list for time-of-day pinning covers all three:
- Daily standup at 9am: `{intervalMs: 86400000, at: [540]}` (540 = 9*60)
- Weekly review at 10am Mondays: not expressible with this model — requires cron. This is a documented limitation; file a new ticket when needed.
- Hourly check: `{intervalMs: 3600000}`

The `at` list pins the first-fire time within the interval; subsequent fires use the interval from that anchor. If `at` is absent, the first fire is `intervalMs` from `startedAt` (the scheduler start time). If `at` is present, the scheduler computes the next occurrence of any listed minute-of-day value and fires then; subsequent fires are `intervalMs` apart from that anchor.

### q2: Definitions file — `settings.json` → `workflow.routines`

**Default:** `settings.json` → `workflow.routines: [{name, schedule, prompt, enabled}]`. Reuse existing settings persistence. [locked by planner default]

**Rationale:** The existing settings mechanism (`settings.json`, `persistWorkflowMode` pattern in `settings-mode.ts`) already handles atomic read/write, is already loaded at session start, and is already injected-tested. A separate `routines.json` would need a new read/write path, new error handling, and new lifecycle wiring. Reusing the settings file means:
- Routines are always available without extra I/O.
- Atomic write guarantees (temp-file-plus-rename) apply automatically.
- The settings file is the single source of truth.
- Documented in `settings.example.json` under `workflow.routines`.

Routine definition shape:
```typescript
interface RoutineDefinition {
  readonly name: string;           // Unique, terminal-safe, <= 40 chars
  readonly schedule: {
    readonly intervalMs: number;   // ms between fires, clamped [60000, 86400000 * 7]
    readonly at?: readonly number[]; // minutes of day (0-1439), optional
  };
  readonly prompt: string;         // The prompt/task template
  readonly enabled: boolean;       // Can be toggled via disable command
  readonly snoozedUntil?: number;  // Epoch ms; skip until this time
}
```

### q3: Dispatch — quiet-default: banner + explicit run

**Default:** A due routine shows a non-blocking banner in-session. The user must explicitly invoke it (or snooze/disable). Never auto-runs. [locked by planner default]

**Rationale:** The issue states "quiet defaults so they never interrupt flow." Auto-running a routine could interrupt a user mid-conversation, mid-edit, or mid-code-review. The banner is a single non-blocking notification line rendered in the belowEditor status surface (not an overlay). The user acts on it when ready. This matches Claude Code routines — they prompt, they don't barge in.

The banner line: `routine <name> due · /run <name> to execute · /snooze <name> to skip`.

### q4: Fleet routing from a routine — user-triggered run routes through `classifyRequest` with current mode

**Default:** When the user runs a routine, the routine's prompt text is classified by `classifyRequest` with the current `workflow.mode`. No new trust edge. [locked by planner default]

**Rationale:** The routine's `prompt` is treated as a normal user request. In `workflow` mode, a risky/broad prompt may route to the fleet. In `free` mode, it goes direct unless an explicit stage is named. This means:
- A routine that says "audit the codebase for security issues" in `workflow` mode → fleet planner.
- A routine that says "show me the weather" in `free` mode → direct.
- INV-8 holds: the mode only changes routing, never authz or data exposure. The routine system does not spawn or send on the subagent bridge by itself.

### q5: Suppression — snooze (skip N intervals) + disable + cancel-banner

**Default:** Three levels of suppression. [locked by planner default]

1. **Cancel-banner** ("Not now"): dismiss the banner, routine re-fires next interval.
2. **Snooze** (`/snooze <name> [N]`): skip N intervals (default 1, stored in `routine.snoozedUntil` = `now + intervalMs * N`). The routine is still enabled; it just won't fire until `snoozedUntil` passes.
3. **Disable** (`/disable-routine <name>`): set `enabled: false` in the routine definition, persists to settings. The routine is removed from the scheduler's active list. Can be re-enabled with `/enable-routine <name>`.

### q6: Failure rules — never throws; per-routine isolation; off-render only

**Default:** The scheduler catches per-routine errors and never propagates them. One broken routine does not prevent other routines from firing. All scheduler logic runs off the render path (on its own timer, like `tracker-poll.ts`). [locked by planner default]

**Rationale:** A malformed routine definition (missing `prompt`, invalid `intervalMs`, etc.) or a throwing check should not kill the entire scheduler. The scheduler:
- Validates each routine on load (schema check).
- Skips invalid routines with a stored reason (`routine <name> unavailable — <reason>`).
- Re-validates on each tick (a broken routine might have been fixed by a settings edit).
- Records the last error per routine.
- Never throws out of the tick handler.

### q7: Surface — belowEditor widget section + `/flow` Routines tab + `/routine` command

**Default:** [locked by planner default]

1. **belowEditor widget** gains a routines section immediately after the issues section:
   - Section rule: `─ routines ───` (or `─ routines · 1 due ───` with count).
   - One row per due routine: `◉ <name> · <schedule summary> · <age>`.
   - One row per snoozed/disabled routine: `· <name> · <schedule> · snoozed (<N>m)` or `· <name> · disabled`.
   - At width < 60, only due routines are shown with collapsed format.
   - Overflow: if the total line count exceeds `maxLines`, the final overflow line includes both issue and routine suppressed counts.

2. **`/flow` Routines tab** shows the full routine list with all details: name, schedule, prompt preview, enabled/snoozed state, last-fired time, error reason (if any), and options (run/snooze/disable/enable).

3. **`/routine` command** mirrors `/mode`:
   - Bare `/routine` → native picker of available (enabled, not snoozed) routines.
   - `/routine <name>` → show that routine's details and actions.
   - `/run <name>` → classify the routine's prompt and execute it.
   - `/snooze <name> [N]` → snooze N intervals.
   - `/disable-routine <name>` → disable.
   - `/enable-routine <name>` → re-enable.

### q8: Test seam — injected `setTimer`/`now` (mirror `tracker-poll.ts`), in-memory settings, deterministic, no fixed sleeps

**Default:** Inject `setTimer`, `clearTimer`, `now` for the scheduler clock; inject `readSettings`/`writeSettings` for the definitions store. The in-memory test harness never touches the filesystem. [locked by planner default]

**Rationale:** The `tracker-poll.ts` pattern already proves this works: deterministic fake-clock tests without real sleeps. The scheduler module accepts the same injection pattern. The definitions store is tested via `settings-mode.ts`'s existing in-memory pattern.

---

## 3. Invariants

### 3.1 Preserved unchanged

- **INV-1 measured-only telemetry.** No number is displayed that was not measured. Unknown stays unknown.
- **INV-2 secret redaction.** No credential, header, token, or URL secret reaches any surface. Routine definitions that contain secrets are redacted on display.
- **INV-3 render path does no I/O and holds a perf budget.** The scheduler runs off-render; the belowEditor surface receives already-computed routine state.
- **INV-4 (amended) bounded, not capped.** The routines section adds deterministic lines based on routine count, subject to the same `maxLines` ceiling.
- **INV-5 staleness `~`.** Routine last-fired time and age use the `~` convention.
- **INV-6 throwing getters degrade to base output.** A throwing routine state getter cannot crash the surface.
- **INV-8 no new trust edge.** The routine system classifies prompts through the existing `classifyRequest`; it never spawns or sends on the subagent bridge by itself.
- **INV-10 off-render reads with capture timestamps.** The scheduler runs on its own timer, off the render path.
- **INV-11 no meaning by colour alone.** Routine status is spelled as text, never colour-only.
- **INV-12 mode persistence is atomic, idempotent, and minimal.** Routine definitions in settings follow the same atomic write pattern.
- **INV-13 fixed-interval polling is single-flight and off-render.** The scheduler is single-flight per-routine: a tick that fires while a routine is still running is skipped, not queued.
- **INV-14 render budget is measured, not asserted.** Routines section adds at most a few lines; the 50 ms ceiling still holds.

### 3.2 New invariants (testable)

- **INV-15 scheduler is single-flight per routine.** A routine whose check (is it due?) is in flight when the next tick fires is skipped for that tick. Different routines may fire concurrently, but a single routine never overlaps with itself.
- **INV-16 routine definitions are validated on load.** A routine missing `name`, `prompt`, or `schedule.intervalMs` is rejected with a stored reason. A routine with an invalid `intervalMs` (< 60000 or > 604800000) is clamped, not rejected. A routine with a duplicate name is rejected (the first wins; the second is stored with a reason).
- **INV-17 banner is non-blocking.** The belowEditor banner is a passive status line, not an overlay, not a modal, not a notification that steals focus. It does not prevent typing.
- **INV-18 scheduler lifecycle is bounded.** The scheduler timer is `unref`'d and cleared on `session_shutdown`. The scheduler never holds the process open.

---

## 4. Architecture

```
extensions/workflow/routine-scheduler.ts      NEW  off-render scheduler, injectable timers, per-routine isolation
extensions/workflow/routine-scheduler.test.ts  NEW  deterministic fake-clock tests
extensions/workflow/routine-definitions.ts     NEW  validation + settings read/write for workflow.routines
extensions/workflow/routine-definitions.test.ts NEW
extensions/workflow/routine-commands.ts        NEW  /routine, /run, /snooze, /disable-routine, /enable-routine
extensions/workflow/routine-commands.test.ts   NEW
extensions/ui-customization/status-widget.ts   EDIT add routines section to renderStatusWidget
extensions/ui-customization/status-widget.test.ts EDIT add routines section tests
extensions/workflow/index.ts                   EDIT lifecycle: start scheduler on session_start, wire commands, clean up on shutdown
extensions/workflow/routine-panel.ts           NEW  /flow Routines tab
extensions/workflow/routine-panel.test.ts      NEW
settings.example.json, README.md, SYSTEM.md    EDIT document routines
```

Data flow:
- `session_start` → `startRoutineScheduler({ routines, now, setTimer, clearTimer, onDue })` → registers the timer.
- Every tick (interval = `gcd` of all routine intervals, clamped to [5000, 60000], default 10000): check each routine → if due and enabled and not snoozed → emit `{ routine, dueAt }` to `onDue`.
- `onDue` updates a shared state object: `{ dueRoutines: [{name, schedule, prompt, dueAt, age}] }`.
- The belowEditor widget reads this state on render (off-render timer separate from render).
- User runs a routine → `classifyRequest(routine.prompt, currentMode)` → normal routing.

---

## 5. Dependency order

```
PI-28  scheduler engine (off-render, injectable timers, per-routine isolation)  [no blockers]
  └─ PI-30  banner + /routine command  (blocked-by PI-28, PI-29)
       └─ PI-31  belowEditor + /flow Routines tab  (blocked-by PI-30)
            └─ PI-32  lifecycle wiring + docs + regression  (blocked-by PI-31)
PI-29  routine definitions in settings  [no blockers; parallel to PI-28]
```

PI-28 and PI-29 are the two parallel entry points. PI-32 is the closing gate.

---

## 6. Scope boundaries

- **No application code is written by this plan.** Planner produces the spec, the tickets, and the board rows only.
- `extensions/workflow/tracker-poll.ts` is read-only for this effort. The scheduler mirrors its pattern but is a separate module.
- `extensions/workflow/settings-mode.ts` is read-only for this effort. Routine definitions use a new module (`routine-definitions.ts`) that mirrors the same pattern.
- No ticket here changes routing semantics, authz, or data exposure. Routines route through the existing `classifyRequest` (INV-8).
- Every ticket enters the board as `Planned`. Only `/reviewer` may move a ticket to `Done`.
- No push, tag, or release is authorized by this plan.

---

## 7. Verification-command policy

Every ticket's Verification-command is:
- Exact and runnable at repo root with `node --test --experimental-strip-types <ticket-test-files> && npm run check`.
- The closing gate (PI-32) adds `npm run format:check`.
- Full `npm test` is not run per ticket; it is run at PI-32 only.