# Tickets — Vraj Pi

Local-file tracker (no GitHub Project for this repo; see `docs/2026-08-04-flow-ui-and-token-savings.md`).
Work top to bottom. A ticket is claimable only when every **Blocked-by** ticket is Done.
Every `Verification-command` is run from the repo root and must exit 0 exactly when the ticket is complete.

Status legend: `Planned` · `Agent Ready` · `Coding` · `Debugger Ready` · `Debugging` · `Review Ready` · `Reviewing` · `Done`

---

## PI-01 — Stage identity and start time on subagent summaries

Status: **Done** · Blocked-by: none · Phase 1

**What to build.** Extend `WorkflowSubagentSummary` in `extensions/shared/workflow-state.ts` with `stage?: StageName` and `startedAt: number` (epoch ms), extend `isWorkflowSubagentSummary` to validate them, tag agents spawned by `startStage` in `extensions/workflow/index.ts` with their stage, and pass both fields through `summarize` in `extensions/subagents/index.ts`.

**Acceptance criteria.**
- `isWorkflowSubagentSummary` returns `false` when `startedAt` is missing or is not a number.
- `isWorkflowSubagentSummary` returns `false` when `stage` is present but is not one of `planner|coder|debugger|reviewer`.
- `isWorkflowSubagentSummary` returns `true` for a summary with no `stage` (a non-stage helper agent).
- An agent spawned through the workflow tool's `start` action carries `stage` equal to the started stage.
- A helper agent spawned through `subagent_spawn` carries no `stage`.

**Verification-command.** `node --test --experimental-strip-types extensions/shared/workflow-state.test.ts extensions/workflow/policy.test.ts && npm run check`

**Review (reviewer, 2026-08-04).**
- Verdict: **PASS** (score: 94/100, diagnostic only)
- Bounce: 0 of 3
- Gate: `node --test --experimental-strip-types extensions/shared/workflow-state.test.ts extensions/workflow/policy.test.ts && npm run check` → exit 0 (13 tests pass; tsc clean)
- Blocking findings: none
- Advisory: Verification-command does not run `extensions/subagents/manager.test.ts`; stage/helper propagation is covered there and was re-run green (exit 0) during review. Full workflow→event-bus→subagents extension round trip remains unharnessed.
- Routing: → **Done** — all five acceptance criteria met in code; INV-6 boundary on non-finite `startedAt` held; no blocking rubric defects.


**Debugger audit (2026-08-04).**
- Baseline four-net result: the exact gate was green before the audit; no failing tests or static errors. The original tests covered validator acceptance/rejection but did not cover non-finite timestamps, runtime manager propagation, or the helper summary shape.
- Fixed INV-1/INV-6 boundary weakness: `isWorkflowSubagentSummary` now rejects `NaN`, `Infinity`, and `-Infinity` timestamps in addition to missing/non-number values.
- Fixed helper-vs-stage identity weakness: helper snapshots and summaries omit the `stage` property entirely; workflow stage snapshots and summaries retain the valid stage. Added a real manager-runtime regression test for both paths.
- Timestamp review: `startedAt` remains the manager-created epoch-ms value copied unchanged by summarization. Workflow persistence stores `WorkflowState`, not summaries, and does not reconstruct malformed summary timestamps.
- Red-team inputs included missing, null, string, non-finite, invalid-stage, valid-stage, helper, and stage cases. No persistence or provider-routing defect was found.
- **Unfixed follow-up:** the production `workflow` → event bus → `subagents` extension → manager → published summary round trip still has no dedicated runtime harness. The manager/runtime seam is tested; the extension-to-extension seam remains for the reviewer/follow-up test work.

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

**Review (reviewer, 2026-08-04).**
- Verdict: **PASS** (score: 96/100, diagnostic only)
- Bounce: 0 of 3
- Gate: `node --test --experimental-strip-types extensions/shared/stage-progress.test.ts && npm run check` → exit 0 (13 tests pass; tsc clean)
- Blocking findings: none
- Advisory: no-I/O source assertion is regex-on-source (honest for static imports; module also has zero import statements). UI `~`/dim rendering of stale readings remains PI-04.
- Routing: → **Done** — all five acceptance criteria met; INV-1/INV-5/INV-6 held on this pure module; pure/no-I/O and no-false-progress confirmed from diff + independent probes.

**Debugger audit (2026-08-04).**
- Claim path: `Debugger Ready` → `Debugging` → `Review Ready`; local-file tracker mode, no GitHub Project, no remote, no push claim.
- Baseline four-net result: the exact gate was green before the audit; no failing tests or static errors. The original tests did not directly cover non-finite `done`, malformed runtime containers, malformed timestamps/counters, future clocks, invalid stale inputs, or immutability.
- Red-team defects found: finite numerators/denominators paired with non-finite `at` produced measured readings; malformed inputs could throw or pass NaN/negative counters through; `isStale` could treat malformed readings or a NaN clock as fresh; readings were mutable.
- Fixed test-first: malformed runtime containers now degrade to frozen indeterminate readings; invalid sources on object inputs still throw; non-finite `done`/`total`/`at` never yield a percent; invalid counters normalize safely; malformed stale inputs are conservatively stale; future timestamps remain non-stale; all returned readings are frozen and inputs are not mutated.
- Added 5 regression tests covering the requested boundaries while preserving the exact source allowlist and no-I/O assertion. The module still has zero imports and no rendering, tracker, filesystem, subprocess, or network path.
- Honest follow-up: none identified within PI-02's pure builder/staleness scope. UI consumption remains PI-04's scope and was not touched.
- Routing: → **Review Ready** for independent review by `/reviewer`.

---

## PI-03 — ~~Ticket progress source~~ (DROPPED)

Status: **Dropped** · Phase 1

Dropped by the user's final answer to decision 2 (measured-only percentages, tracker excluded). No tracker read is on the UI path, which also removes the only filesystem dependency from the progress feature. The ID is retired rather than reused so downstream references stay unambiguous.

---

## PI-04 — Adaptive persistent footer with live stage rows (INV-3, INV-4, INV-5)

Status: **Done** · Blocked-by: PI-02 · Phase 1

**What to build.** Extract the footer body of `extensions/ui-customization/index.ts` into a pure `renderFooter(state) => string[]` function and add adaptive stage rows: the existing 3 base lines, plus one row per tracked planner–reviewer agent — `<glyph> <stage> <backend>/<model> · <elapsed> · <turns>t · <progress>` — where `<progress>` is a percent only for a measured reading and is omitted otherwise.

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

**Review (reviewer, 2026-08-04).**
- Verdict: **PASS** (score: 95/100, diagnostic only)
- Bounce: 0 of 3
- Gate: `node --test --experimental-strip-types extensions/ui-customization/footer.test.ts && npm run check && npm test` → exit 0 (21 footer tests; tsc clean; 149 node:test + 22 vitest)
- Blocking findings: none
- Advisory: INV-2 secret scrubbing of free-text titles is not exercised on this path (footer shows stage/backend/modelLabel, not task titles). Full production multi-extension TUI still unharnessed beyond the live bus probe in `footer.test.ts`.
- Routing: → **Done** — all nine acceptance criteria held in `footer.ts`/`index.ts`; INV-1/3/4/5/6 demonstrated; independent probe confirmed bounds, helper omission, measured-only `%`, stale `~`, ANSI width, throw fallback, purity, and ≤2 ms/render.

---

## PI-05 — `/flow` parity, why-this-route, and plain-language status

Status: **Done** · Blocked-by: PI-04 · Phase 1

**What to build.** Bring `FlowPanel` in `extensions/workflow/index.ts` in line with the footer: the Agents tab lists stage rows first (using the same progress readings), the Overview tab states the route reason in one plain sentence, and the panel shows what it is waiting on when status is `needs-input`, `needs-helper`, or `blocked`.

**Acceptance criteria.**
- The Agents tab orders planner→reviewer stage agents before helper agents.
- With no agents tracked, the Agents tab renders the literal line ` none tracked` and does not throw.
- Overview renders a `waiting on` line whenever status is `needs-input`, `needs-helper`, or `blocked`, and omits that line otherwise.
- Every panel line is truncated to the panel width at widths 40 and 120.
- No panel line contains a percent for an indeterminate reading.
- Rendering the panel performs no filesystem, network, or subprocess call.

**Verification-command.** `node --test --experimental-strip-types extensions/workflow/flow-panel.test.ts extensions/workflow/policy.test.ts && npm run check`

**Debugger audit (2026-08-04).**
- Claim path: local-file tracker `Debugger Ready` → `Debugging` → `Review Ready`; only PI-05 moved. No GitHub Project and no git remote. Phase 2 and PI-06 were not started.
- Actual profiles: PI-05 maker handoff records Pi · `openai-codex/gpt-5.6-terra` · xhigh; this debugger ran in the Codex debugger session. The repository pin is GPT-5.6 Luna/max, while this runtime exposes the model as GPT-5/Codex rather than a versioned Luna identifier; no helper was spawned or silently substituted.
- Baseline four-net result: the locked gate was green before the audit (12 targeted tests; `tsc` clean), with weak coverage for malformed agent data, unknown stages, terminal/control injection, narrow/non-finite widths, getter failures, stale timestamps, input transitions, and panel performance.
- Fixed test-first: unknown or missing stages now render as stable helper rows while duplicate known stages preserve input order; stage percentages are measured-only. Route reasons, waiting events, task/title/model/session/capability text are one-line, terminal-safe, URL/secret-redacted, and visibly truncated. Malformed counters/timestamps/readings degrade without `NaN`/`Infinity`; stale agent snapshots show `~`; failed data getters fall back safely; frame widths from zero through 120 and non-finite inputs never overflow or throw; runtime agent-update timestamps feed stale detection; tab/arrow/escape behavior and a 1,000-render budget are covered.
- Purity: the FlowPanel render class has no filesystem, network, or subprocess calls; the source-scope assertion remains green.
- Verification: targeted gate passed with 21 tests and `tsc --noEmit`; full `npm test` passed with 164 Node tests and 22 Vitest tests; `npm run format:check` and `git diff --check` passed.
- Honest follow-up: none identified within PI-05. Full production workflow → subagents event-bus round trip remains outside this ticket's harness, as noted by prior stages.

**Reviewer verdict (2026-08-04): FAIL (72/100, diagnostic only) · Bounce 1 of 3.**
- Exact gate passed: 21/21 targeted tests and `tsc --noEmit`, both exit 0, at tested HEAD `a55db618883455ee6e44fdb0eb5332e93e2882e8`.
- Blocking correctness finding: `extensions/workflow/index.ts:118-132` redacts only the first whitespace/comma/semicolon-delimited value after `Authorization` or `Cookie`. A blocked route/event containing `Authorization: Digest username="vraj", response="auth-secret"; Cookie: session=event-secret; csrf=event-csrf` renders `auth-secret` and `event-csrf` in `/flow`, violating INV-2.
- Test gap: `extensions/workflow/flow-panel.test.ts:220-245` covers one `api_key` and one URL but does not exercise complete authorization/cookie header redaction; the independent probe observed all three supplied trailing values in rendered output.
- Route: **Debugger Ready** for a test-first redaction correction. Full `npm test` also exited 1 only because two live Claude backend tests hit the account spend limit; this is outside PI-05 and did not affect the exact gate.

**Reviewer re-review (2026-08-04): FAIL (68/100, diagnostic only) · Bounce 2 of 3.**
- Tested HEAD: `004517f0f8b9238dc819a4c40bef94a93081bd00`.
- Exact gate passed: 22/22 targeted tests and `tsc --noEmit`, exit 0. `npm run format:check` and `git diff --check` each exited 0.
- Blocking correctness finding (INV-2/INV-6): `extensions/workflow/index.ts:109-134` fails closed only for balanced quoted composite headers. Trigger: `Authorization: Digest response="malformed-auth-secret Cookie: session=malformed-cookie-secret`. Result: `/flow` renders `malformed-auth-secret` in both `waiting on` and `event` rows; the independent production-path assertion exited 1.
- Test honesty finding: `extensions/workflow/flow-panel.test.ts:247-267` proves the reported balanced Digest/Cookie regression and quoted Cookie case, but has no malformed-header case that would catch this leak.
- Other PI-05 criteria passed: stage-first ordering with current planner/coder/debugger/reviewer labels, literal ` none tracked`, bounded rows, measured-only percent, waiting-state transitions, terminal-control stripping, and render-path I/O purity.
- Full `npm test` exited 1: 163/165 Node tests passed; two live Claude backend tests failed because the account spend limit was reached. This is external to PI-05 but recorded exactly.
- Route: **Debugger Ready** for fail-closed malformed authorization/cookie redaction plus a production-path regression test.

**Debugger audit (2026-08-04, bounce 2/3).**
- Baseline exact gate was green: 22 targeted tests passed and `tsc --noEmit` passed. The four-net audit found the reviewer-reported malformed-header leak and its missing regression coverage; no other in-scope failure or static error was found.
- TDD fix: added a production-path regression for unbalanced Authorization/Cookie values in both orders, a subsequent sensitive header, neighboring ordinary text, and the existing balanced cases. Replaced quote-aware composite matching with an opaque-span matcher that does not parse or validate quotes/delimiters, preserves line boundaries for neighboring headers, and renders only `Authorization: [REDACTED]` / `Cookie: [REDACTED]`.
- Evidence: `node --test --experimental-strip-types extensions/workflow/flow-panel.test.ts extensions/workflow/policy.test.ts && npm run check` → pass (23 tests; `tsc` clean); `npm run format:check` → pass; `git diff --check` → pass. `npm test` → 164/166 passed; the only failures were the known live Claude monthly spend-limit tests.
- Handoff: `docs/handoffs/2026-08-04-debugger-pi05-bounce-2.md`. No unfixed follow-up within PI-05. Routing: → **Review Ready** for independent review.

**Reviewer final review (2026-08-04): FAIL (62/100, diagnostic only) · Bounce 3 of 3 — HUMAN ESCALATION.**
- Tested HEAD: `7c133094bec8ec171b6b32eba1c256e08790c051`.
- Exact gate passed: 23/23 targeted tests and `tsc --noEmit`, exit 0. `npm run format:check` and `git diff --check` each exited 0.
- Blocking correctness finding (INV-2): `extensions/workflow/index.ts:110-111,122-150` stops sensitive-header redaction at every line boundary. Trigger: a folded value such as `Authorization: Digest username="ordinary",\n response="SYNTHETIC_FOLDED_AUTH_VALUE"` or `Cookie: session=ordinary;\n csrf=SYNTHETIC_FOLDED_COOKIE_VALUE`. Result: the continuation value appears in `/flow` route, `waiting on`, and event rows; the independent production `FlowPanel.render` probe reported `LEAK` for both cases.
- Test honesty finding: `extensions/workflow/flow-panel.test.ts:269-293` verifies unbalanced same-line values and ordinary neighboring lines, but no continuation-line case catches this boundary leak.
- Other PI-05 criteria passed: planner→coder→debugger→reviewer stage-first ordering, literal ` none tracked`, waiting-state labels, width bounds, measured-only percentages, ordinary/URL/ANSI handling, and render-path I/O purity.
- Routing: → **Human escalation** — third failed review found a new substantive INV-2 failure. PI-05 remains **Reviewing** pending a human decision; it is not bounced into another automatic loop.

**Debugger recovery (2026-08-04, human-authorized after bounce 3/3).**
- Added production-path regressions for folded Authorization and Cookie values whose continuation lines begin with a space, preserving ordinary neighboring lines and headers.
- Extended the opaque sensitive-header matcher across only indented continuation lines, stopping at the next non-indented line or another sensitive header; no quote or delimiter parsing was added.
- Red test reproduced the two synthetic continuation leaks; the fixed targeted gate passed with 24 tests and clean TypeScript. The direct `FlowPanel.render` probe also passed folded, balanced, malformed, neighboring, terminal-control, URL, width, and indeterminate-progress checks.
- `npm run format:check` and `git diff --check` passed. No real secrets, provider calls, helpers, or push were used. No unfixed PI-05 follow-up identified.
- Handoff: `docs/handoffs/2026-08-04-debugger-pi05-bounce-3-recovery.md`. Routing: → **Review Ready** for independent review.

**Reviewer recovery review (2026-08-04): PASS (96/100, diagnostic only) · after human-authorized bounce-3 recovery.**
- Tested HEAD: `40e6a2b5747f547b1c0e0b286a7cc3463044837f`.
- Exact gate passed: 24/24 targeted tests and `tsc --noEmit`, exit 0. `npm run format:check` and `git diff --check` each exited 0.
- Independent production `FlowPanel.render` probe passed balanced, malformed/unbalanced, semicolon-separated, quoted, folded space/tab continuation, adjacent sensitive-header, URL, ANSI/control-text, ordinary-neighbor, and width checks without exposing synthetic markers.
- PI-05 criteria passed: planner→coder→debugger→reviewer rows precede helpers and use shared progress readings; Overview gives one plain route-reason sentence; all three waiting states render and non-waiting states omit the line; indeterminate readings show no percent; frame lines are width-safe; footer base plus four stage rows stays at seven lines; render code performs no filesystem, network, or subprocess I/O.
- `npm test` exited 1 with 165/167 Node tests passing; the only failures were the known live Claude monthly-spend-limit tests. The downstream Vitest command did not run because the Node command failed.
- Blocking findings: none. Routing: → **Done** — the human-authorized targeted recovery closes the folded-header INV-2 gap without reopening an automatic bounce loop.

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

---

## PI-10 — `/flow` issue todo list with live ticket statuses

Status: **Planned** · Blocked-by: PI-05 · Phase 3

**What to build.** Add an Issues/Todos view to `/flow` that lists every tracked
ticket with its ID, title, current status, and blocking tickets, so the complete
work queue is visible in one place. The view is read-only: status changes remain
explicit workflow actions, and tracker reads happen before rendering rather than
inside the render path.

**Acceptance criteria.**
- Every ticket in the local tracker appears exactly once with its current status.
- The list includes the ticket ID, title, status, and `Blocked-by` value when present.
- Planned, ready, active, reviewing, done, dropped, and blocked work are visibly distinguishable.
- Missing or malformed tracker data degrades to a bounded `issue list unavailable` message without throwing.
- Every rendered line fits the panel width and user-controlled ticket text is terminal-safe and secret-redacted.
- Rendering the view performs no filesystem, network, or subprocess call; tracker reads are performed off the render path.
- The view never changes ticket status or starts work merely by opening it.

**Verification-command.** `node --test --experimental-strip-types extensions/workflow/issue-list.test.ts && npm run check`
