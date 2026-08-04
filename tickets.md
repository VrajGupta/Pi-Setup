# Tickets — Vraj Pi

Local-file tracker (no GitHub Project for this repo; see `docs/2026-08-04-flow-ui-and-token-savings.md`).
Work top to bottom. A ticket is claimable only when every **Blocked-by** ticket is Done.
Every `Verification-command` is run from the repo root and must exit 0 exactly when the ticket is complete.

Status legend: `Planned` · `Agent Ready` · `Coding` · `Debugger Ready` · `Debugging` · `Grading Ready` · `Done`

---

## PI-01 — Stage identity and start time on subagent summaries

Status: **Done** · Blocked-by: none · Phase 1

**What to build.** Extend `WorkflowSubagentSummary` in `extensions/shared/workflow-state.ts` with `stage?: StageName` and `startedAt: number` (epoch ms), extend `isWorkflowSubagentSummary` to validate them, tag agents spawned by `startStage` in `extensions/workflow/index.ts` with their stage, and pass both fields through `summarize` in `extensions/subagents/index.ts`.

**Acceptance criteria.**
- `isWorkflowSubagentSummary` returns `false` when `startedAt` is missing or is not a number.
- `isWorkflowSubagentSummary` returns `false` when `stage` is present but is not one of `part1|part2|part3|part4`.
- `isWorkflowSubagentSummary` returns `true` for a summary with no `stage` (a non-stage helper agent).
- An agent spawned through the workflow tool's `start` action carries `stage` equal to the started stage.
- A helper agent spawned through `subagent_spawn` carries no `stage`.

**Verification-command.** `node --test --experimental-strip-types extensions/shared/workflow-state.test.ts extensions/workflow/policy.test.ts && npm run check`

**Grade (part4, 2026-08-04).**
- Verdict: **PASS** (score: 94/100, diagnostic only)
- Bounce: 0 of 3
- Gate: `node --test --experimental-strip-types extensions/shared/workflow-state.test.ts extensions/workflow/policy.test.ts && npm run check` → exit 0 (13 tests pass; tsc clean)
- Blocking findings: none
- Advisory: Verification-command does not run `extensions/subagents/manager.test.ts`; stage/helper propagation is covered there and was re-run green (exit 0) during grade. Full workflow→event-bus→subagents extension round trip remains unharnessed.
- Routing: → **Done** — all five acceptance criteria met in code; INV-6 boundary on non-finite `startedAt` held; no blocking rubric defects.


**Part3 debugger audit (2026-08-04).**
- Baseline four-net result: the exact gate was green before the audit; no failing tests or static errors. The original tests covered validator acceptance/rejection but did not cover non-finite timestamps, runtime manager propagation, or the helper summary shape.
- Fixed INV-1/INV-6 boundary weakness: `isWorkflowSubagentSummary` now rejects `NaN`, `Infinity`, and `-Infinity` timestamps in addition to missing/non-number values.
- Fixed helper-vs-stage identity weakness: helper snapshots and summaries omit the `stage` property entirely; workflow stage snapshots and summaries retain the valid stage. Added a real manager-runtime regression test for both paths.
- Timestamp review: `startedAt` remains the manager-created epoch-ms value copied unchanged by summarization. Workflow persistence stores `WorkflowState`, not summaries, and does not reconstruct malformed summary timestamps.
- Red-team inputs included missing, null, string, non-finite, invalid-stage, valid-stage, helper, and stage cases. No persistence or provider-routing defect was found.
- **Unfixed follow-up:** the production `workflow` → event bus → `subagents` extension → manager → published summary round trip still has no dedicated runtime harness. The manager/runtime seam is tested; the extension-to-extension seam remains for the grader/follow-up test work.

---

## PI-02 — Honest progress reading module (INV-1)

Status: **Done** · Blocked-by: PI-01 · Phase 1

**What to build.** A pure module `extensions/shared/stage-progress.ts` exporting a `ProgressReading` discriminated union — `{kind:"measured", percent, done, total, source, at}` or `{kind:"indeterminate", elapsedMs, turns, at}` — plus a builder that accepts only explicit numerator/denominator pairs from the three allowed in-process sources: `context`, `questions`, `stage`. No rendering, no I/O, no tracker.

**Acceptance criteria.**
- Building with a `total` of `0`, `null`, `undefined`, or `NaN` returns `kind:"indeterminate"`, never a percent.
- Building with a `source` outside `context|questions|stage` throws — in particular a `"tickets"` source throws, since tracker-derived percent is out of scope.
- A measured reading clamps `percent` to `0..100` and preserves the exact `done`/`total` it was built from.
- A reading whose `at` is older than 30 000 ms is reported stale by the module's `isStale` helper; `isStale` is exactly `false` at 30 000 ms and `true` at 30 001 ms.
- The module imports nothing from `node:fs`, `node:child_process`, or any network API (asserted by reading its own source text).

**Verification-command.** `node --test --experimental-strip-types extensions/shared/stage-progress.test.ts && npm run check`

**Grade (part4, 2026-08-04).**
- Verdict: **PASS** (score: 96/100, diagnostic only)
- Bounce: 0 of 3
- Gate: `node --test --experimental-strip-types extensions/shared/stage-progress.test.ts && npm run check` → exit 0 (13 tests pass; tsc clean)
- Blocking findings: none
- Advisory: no-I/O source assertion is regex-on-source (honest for static imports; module also has zero import statements). UI `~`/dim rendering of stale readings remains PI-04.
- Routing: → **Done** — all five acceptance criteria met; INV-1/INV-5/INV-6 held on this pure module; pure/no-I/O and no-false-progress confirmed from diff + independent probes.

**Part3 debugger audit (2026-08-04).**
- Claim path: `Debugger Ready` → `Debugging` → `Grading Ready`; local-file tracker mode, no GitHub Project, no remote, no push claim.
- Baseline four-net result: the exact gate was green before the audit; no failing tests or static errors. The original tests did not directly cover non-finite `done`, malformed runtime containers, malformed timestamps/counters, future clocks, invalid stale inputs, or immutability.
- Red-team defects found: finite numerators/denominators paired with non-finite `at` produced measured readings; malformed inputs could throw or pass NaN/negative counters through; `isStale` could treat malformed readings or a NaN clock as fresh; readings were mutable.
- Fixed test-first: malformed runtime containers now degrade to frozen indeterminate readings; invalid sources on object inputs still throw; non-finite `done`/`total`/`at` never yield a percent; invalid counters normalize safely; malformed stale inputs are conservatively stale; future timestamps remain non-stale; all returned readings are frozen and inputs are not mutated.
- Added 5 regression tests covering the requested boundaries while preserving the exact source allowlist and no-I/O assertion. The module still has zero imports and no rendering, tracker, filesystem, subprocess, or network path.
- Honest follow-up: none identified within PI-02's pure builder/staleness scope. UI consumption remains PI-04's scope and was not touched.
- Routing: → **Grading Ready** for independent part4 review.

---

## PI-03 — ~~Ticket progress source~~ (DROPPED)

Status: **Dropped** · Phase 1

Dropped by the user's final answer to decision 2 (measured-only percentages, tracker excluded). No tracker read is on the UI path, which also removes the only filesystem dependency from the progress feature. The ID is retired rather than reused so downstream references stay unambiguous.

---

## PI-04 — Adaptive persistent footer with live stage rows (INV-3, INV-4, INV-5)

Status: **Done** · Blocked-by: PI-02 · Phase 1

**What to build.** Extract the footer body of `extensions/ui-customization/index.ts` into a pure `renderFooter(state) => string[]` function and add adaptive stage rows: the existing 3 base lines, plus one row per tracked part1–part4 agent — `<glyph> <stage> <backend>/<model> · <elapsed> · <turns>t · <progress>` — where `<progress>` is a percent only for a measured reading and is omitted otherwise.

**Acceptance criteria.**
- With no tracked agents the footer renders exactly 3 lines (plus any extension status lines, unchanged from today).
- With 2 tracked stage agents the footer renders exactly 5 lines; with 4 it renders exactly 7; a 5th stage agent adds no 6th row.
- Non-stage helper agents produce no footer row.
- Every returned line has a visible width ≤ the requested width, at widths 20, 60, 80, and 200.
- A stage row whose reading is `indeterminate` contains no `%` character.
- A stage row whose reading is stale renders with a leading `~`.
- `renderFooter` throwing is impossible to observe: when a supplied reading getter throws, the function still returns the 3 base lines.
- 1 000 `renderFooter` calls at width 200 complete in under 2 000 ms total (≤2 ms each).
- `renderFooter`'s module performs no `node:fs`, `node:child_process`, or network calls.

**Verification-command.** `node --test --experimental-strip-types extensions/ui-customization/footer.test.ts && npm run check && npm test`

**Grade (part4, 2026-08-04).**
- Verdict: **PASS** (score: 95/100, diagnostic only)
- Bounce: 0 of 3
- Gate: `node --test --experimental-strip-types extensions/ui-customization/footer.test.ts && npm run check && npm test` → exit 0 (21 footer tests; tsc clean; 149 node:test + 22 vitest)
- Blocking findings: none
- Advisory: INV-2 secret scrubbing of free-text titles is not exercised on this path (footer shows stage/backend/modelLabel, not task titles). Full production multi-extension TUI still unharnessed beyond the live bus probe in `footer.test.ts`.
- Routing: → **Done** — all nine acceptance criteria held in `footer.ts`/`index.ts`; INV-1/3/4/5/6 demonstrated; independent probe confirmed bounds, helper omission, measured-only `%`, stale `~`, ANSI width, throw fallback, purity, and ≤2 ms/render.

---

## PI-05 — `/flow` parity, why-this-route, and plain-language status

Status: **Debugger Ready** · Blocked-by: PI-04 · Phase 1

**What to build.** Bring `FlowPanel` in `extensions/workflow/index.ts` in line with the footer: the Agents tab lists stage rows first (using the same progress readings), the Overview tab states the route reason in one plain sentence, and the panel shows what it is waiting on when status is `needs-input`, `needs-helper`, or `blocked`.

**Acceptance criteria.**
- The Agents tab orders part1→part4 stage agents before helper agents.
- With no agents tracked, the Agents tab renders the literal line ` none tracked` and does not throw.
- Overview renders a `waiting on` line whenever status is `needs-input`, `needs-helper`, or `blocked`, and omits that line otherwise.
- Every panel line is truncated to the panel width at widths 40 and 120.
- No panel line contains a percent for an indeterminate reading.
- Rendering the panel performs no filesystem, network, or subprocess call.

**Verification-command.** `node --test --experimental-strip-types extensions/workflow/flow-panel.test.ts extensions/workflow/policy.test.ts && npm run check`

---

## PI-06 — Adopt Ponytail and Caveman-style terseness explicitly (Phase 2)

Status: **Planned** · Blocked-by: PI-04 · Phase 2

**What to build.** Make the already-installed Ponytail package a declared, pinned part of this configuration and give Pi a Caveman-equivalent terse-output policy: record the package in `settings.example.json`, document both in `README.md` and `SYSTEM.md`, add a `skills/terse-output/SKILL.md` porting the Caveman rules (including its safety exception for security warnings, irreversible actions, and multi-step sequences), and make `install.sh` merge rather than overwrite the user's existing `packages` list.

**Acceptance criteria.**
- `settings.example.json` lists `git:github.com/DietrichGebert/ponytail` in `packages`.
- Running the installer against a settings file that already contains a user package leaves that package present and adds the Ponytail entry exactly once (no duplicate on a second run).
- `skills/terse-output/SKILL.md` exists and states the exception cases verbatim: security warnings, irreversible action confirmations, and multi-step sequences are never compressed.
- `SYSTEM.md` names Ponytail and the terse-output policy.
- No secret, key, or token appears in any file changed by this ticket.

**Verification-command.** `node --test --experimental-strip-types extensions/workflow/config-docs.test.ts && npm run check`

---

## PI-07 — Prompt-cache-stable system prompt assembly (Phase 2)

Status: **Planned** · Blocked-by: PI-06 · Phase 2

**What to build.** Today `extensions/workflow/index.ts` appends a per-turn route block to the system prompt. Split assembly into an explicitly stable prefix and a volatile suffix, and prove the prefix is byte-identical across turns whose route differs.

**Acceptance criteria.**
- Two assemblies with different route decisions produce a byte-identical stable prefix.
- The volatile suffix is the only region that differs, and it appears after the entire stable prefix.
- Changing the user's task text does not change the stable prefix.
- Changing the active stage changes only the volatile suffix.
- The assembled prompt contains no credential, key, token, or provider base URL (INV-2, INV-8).

**Verification-command.** `node --test --experimental-strip-types extensions/workflow/prompt-assembly.test.ts extensions/workflow/policy.test.ts && npm run check`

---

## PI-08 — Windows support for the whole Pi workflow (INV-7)

Status: **Planned** · Blocked-by: PI-07 · Phase 2

**What to build.** Replace the bash+python `install.sh` path with a cross-platform Node installer (`scripts/install.mjs`, invoked by both `install.sh` and a new `install.ps1`) that resolves the agent dir, links or copies resources, and merges settings; make every path join platform-safe; confirm the notification branch degrades cleanly on Windows; and document the Windows setup in `SETUP.md`.

**Acceptance criteria.**
- `node scripts/install.mjs --dry-run --agent-dir <tmp>` exits 0 on the current platform and reports every resource it would link or copy, without modifying the real `~/.pi/agent`.
- Running the installer twice against the same temp agent dir is idempotent: the second run produces the same final settings content as the first.
- When symlink creation fails (simulated), the installer falls back to copying and reports which resources were copied, exiting 0.
- The notification helper returns without throwing when the platform notifier is unavailable, on every platform branch.
- No path in changed code is built by string concatenation with `/`; all use `node:path`.
- `SETUP.md` documents the Windows install command and the fact that `bin/fd` is a platform-specific download, not a committed binary.

**Verification-command.** `node --test --experimental-strip-types extensions/shared/*.test.ts && node scripts/install.mjs --dry-run --agent-dir "$(mktemp -d)" && npm run check && npm test`

---

## PI-09 — Investigate-only: compressing proxy evaluation (no adoption)

Status: **Planned** · Blocked-by: PI-06 · Phase 2 · May run in parallel with PI-07/PI-08

**What to build.** A written evaluation at `docs/2026-08-04-proxy-evaluation.md` of routing Pi through a compressing proxy — OmniRoute's RTK + Caveman compression (source already on this machine at `~/.hermes/node/lib/node_modules/omniroute`), and Headroom **if and only if** a real artifact or primary source for it can be identified. This ticket produces a recommendation and changes no configuration.

**Acceptance criteria.**
- `docs/2026-08-04-proxy-evaluation.md` exists and contains, for each candidate: what it compresses, where in the request it sits, the measured or vendor-claimed savings **with the claim's source cited**, and whether the claim was independently reproduced or not.
- The document states, for each candidate, its effect on provider-side prompt caching, and says plainly when that effect is unknown rather than guessing.
- The document lists exactly what the third party would see (system prompt, file contents, tool output, credentials) and names the resulting trust edge, including the fact that `agentrouter.org` already sits on the Anthropic route today.
- The document ends with one of three explicit verdicts — `adopt`, `reject`, or `needs a further spike` — and the concrete next step for that verdict.
- If no primary source for "Headroom" can be found, the document says so and marks it unassessed rather than describing it.
- The diff for this ticket touches no file outside `docs/`: `models.json`, `settings.json`, `settings.example.json`, and all provider routing are unchanged (INV-8).
- No credential, key, token, or real user prompt appears in the document or in any command it records; any measurement uses synthetic prompts and no credentials.

**Verification-command.** `test -f docs/2026-08-04-proxy-evaluation.md && grep -Eq '^Verdict: (adopt|reject|needs a further spike)$' docs/2026-08-04-proxy-evaluation.md && git diff --quiet HEAD -- settings.example.json install.sh SYSTEM.md package.json && npm run check`

The `git diff --quiet` clause is the INV-8 guard: this ticket must leave every routing/config file byte-identical, so the gate fails if the spike edited one.
