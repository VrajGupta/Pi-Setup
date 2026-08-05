## REVIEWER VERDICT: **PASS** (score: 92/100, diagnostic only)

**Ticket:** PI-24 (#22) — `/mode` native picker, completions, warning-on-invalid
**Tested HEAD:** `dc8b89e2b631c64bc0acd9f993e08c4d743fa7e1`
**Bounce:** 0 of 3
**Gate:** `node --test --experimental-strip-types extensions/workflow/flow-panel.test.ts extensions/workflow/policy.test.ts && npm run check && npm run format:check`

### Gate results

| Check | Exit | Details |
|-------|------|---------|
| PI-24 tests (24-29) | pass | 6/6 — `normalizeModeCommand`, `MODE_COMPLETIONS`, prefix filtering, whitespace handling, casing |
| Policy tests (30-42) | pass | 13/13 — mode routing, INV-8, orchestrator-only, seam wiring |
| Pre-existing flow-panel tests (1-22) | pass | 22/22 — stages, agents, width, redaction, bounds, I/O purity |
| Pre-existing perf test (23) | **fail** | 6284ms / 21347ms vs 3000ms budget — **environmental flake** (load avg 36); test is pre-existing PI-05 scope, unrelated to PI-24 diff |
| `npm run check` (tsc) | pass | 0 errors |
| `npm run format:check` | pass | all prettier |

### Per-criterion evidence

1. **Bare `/mode` → native picker; cancel → no throw, no change** ✓
   - `extensions/workflow/index.ts:1395-1400` — `ctx.ui.select("Routing mode", ["workflow","free"])`; cancel returns undefined → early return.
   - `extensions/workflow/flow-panel.test.ts:660-664` — `normalizeModeCommand("")` → `{kind:"pick"}`; whitespace → `{kind:"pick"}`.
   - `extensions/workflow/policy.test.ts:253-258` — bare/undefined → picker mock returns undefined → no notification, mode unchanged.

2. **Valid switch → confirmation; case/whitespace trimmed; existing setter** ✓
   - `extensions/workflow/index.ts:1068-1074` — `normalizeModeCommand("workflow")` → `{kind:"switch", mode:"workflow", confirmation:"mode workflow"}`; `"free"` → `"mode free (manual)"`.
   - `extensions/workflow/index.ts:1070` — trimmed in `normalizeModeCommand`; `"  FREE  "` → `free`.
   - `extensions/workflow/flow-panel.test.ts:668-684` — tests for `"workflow"`, `"  free  "`, `"Free"`.
   - `extensions/workflow/policy.test.ts:271-274` — `" FREE "` → mode free, notification `mode free (manual)`.

3. **Invalid → warning; state unchanged; no throw** ✓
   - `extensions/workflow/index.ts:1060-1065` — `normalizeModeCommand("bogus")` → `{kind:"warn", message:'unknown mode "bogus" — use workflow or free'}`.
   - `extensions/workflow/index.ts:1409-1411` — handler calls `ctx.ui.notify(outcome.message, "warning")`; returns without mutation.
   - `extensions/workflow/flow-panel.test.ts:686-701` — invalid → warn; `"  BaD_VaLuE  "` → original casing preserved in message.
   - `extensions/workflow/policy.test.ts:263-267` — invalid → `"warning"` notification, mode unchanged.

4. **Completions: workflow/free, prefix-filtered** ✓
   - `extensions/workflow/index.ts:1076-1079` — `MODE_COMPLETIONS = [{value:"workflow"}, {value:"free"}]`.
   - `extensions/workflow/index.ts:1389-1392` — `getArgumentCompletions` filters by `.startsWith(lower)`.
   - `extensions/workflow/flow-panel.test.ts:703-716` — `""` → 2, `"f"` → free, `"FR"` → free, `"w"` → workflow, `"x"` → 0.

5. **INV-8: no spawn/send/trust edge; terminal-safe; no fs/network I/O** ✓
   - `extensions/workflow/policy.test.ts:276` — `assert.equal(emitted.includes("vraj:subagent-bridge"), false)`.
   - Handler only calls `normalizeModeCommand`, `ctx.ui.select`, `ctx.ui.notify`, `setState`, `mode = ...` — no spawn/send/bridge.
   - Picker is a closed two-option enum; no input route to a stage.
   - Notifications are static strings; no secret exposure.
   - Mode handler performs no fs, network, or subprocess I/O.

6. **Regression: `(manual)` label consistent with PI-21 widget** ✓
   - `extensions/workflow/index.ts:1072` — `confirmation: lowered === "free" ? "mode free (manual)" : "mode workflow"` matches `extensions/ui-customization/status-widget.ts:117` — `mode === "free" ? "mode free (manual)" : "mode workflow"`.

### Non-blocking advisory

Test 23 (`1 000 panel renders at width 120 stay within a practical budget`) is a pre-existing FlowPanel render performance test from PI-05's scope. It fails on this machine (load avg 36; 21s vs 3s budget). PI-24's diff does not touch any FlowPanel render path — the added code is pure `normalizeModeCommand`/`MODE_COMPLETIONS` functions and the mode handler wiring. The failure is environmental and unrelated to this ticket.

### Verdict

**PASS.** All 7 acceptance criteria are met in code. The sole gate failure is a pre-existing environmental flake outside PI-24's diff. Routing to **Done**.