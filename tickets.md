# Tickets — Vraj Pi

Local-file tracker (no GitHub Project for this repo; see `docs/2026-08-04-flow-ui-and-token-savings.md`
and the addendum `docs/2026-08-04-flow-todo-crossrepo-and-docs.md`).
Work top to bottom. A ticket is claimable only when every **Blocked-by** ticket is Done.
Every `Verification-command` is run from the repo root and must exit 0 exactly when the ticket is complete.

Status legend: `Planned` · `Agent Ready` · `Coding` · `Debugger Ready` · `Debugging` · `Review Ready` · `Reviewing` · `Done`

GitHub issue mirror. Live board: **GitHub Project #12 (owner `VrajGupta`)** — its `Status` field is the
workflow authority for stage state; this file mirrors it and carries the durable ticket text.

`PI-06 → #2` · `PI-07 → #9` · `PI-08 → #10` · `PI-09 → #11` · `PI-10 → #7` · `PI-11 → #1`
`PI-12 → #6` · `PI-13 → #4` · `PI-14 → #8` · `PI-15 → #12` · `PI-16 → #3` · `PI-17 → #5`

## Immediate priority override

1. **Orchestrator-only conversation (user-restated, 2026-08-04)** — Vraj talks only to the orchestrator. No keystroke, setting, or extension hook may deliver his input to a stage agent. Includes the Pi `steeringMode` setting and the header `STEER` label. → PI-11.
2. **Honest stage telemetry** — explain elapsed/turn/context labels, suppress unavailable zero-token readings, render tiny measured use as `<1% ctx`, never a misleading `0%` that reads as task progress, and never leave a stage row silent for minutes with no reason. → PI-11, PI-16.
3. **Todo list** — PI-13 → PI-10 → PI-14 (repository, ticket, assignee, pipeline status, blockers, honest ETA; then cross-repository).
4. **Footer consolidation** — PI-12 (retire the header status block; the footer is the single persistent status surface).
5. **Token saving / portability / evaluation** — PI-06 → PI-07 → PI-08 (+ PI-09 in parallel), then PI-15 for setup/rollback docs.

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

Status: **Agent Ready** · Blocked-by: PI-06 (Done) · Phase 2 · GitHub issue #9

**What to build.** Today `extensions/workflow/index.ts` appends a per-turn route block to the system prompt. Split assembly into an explicitly stable prefix and a volatile suffix, prove the prefix is byte-identical across turns whose route differs, and scrub credentials of the **supported shapes below** before either region is assembled.

**Scope decision (human-authorized narrowing, 2026-08-04, after bounce 3/3 escalation).** PI-07's credential criterion was originally absolute ("no credential of any syntax"). Three bounces plus one authorized recovery pass showed the absolute was being chased with an expanding syntax blacklist that does not converge. The human decision is: **narrow PI-07 to the supported credential-redaction boundary already implemented; do not attempt another redaction implementation now.**

*Supported boundary — PI-07 guarantees redaction for:* (1) named credential assignments (`api_key`, `access_key`, `access_token`, `aws_access_key_id`, `authorization`, `cookie`, `credential`, `password`, `passwd`, `private_key`, `secret`, `token`, `*_url`, `*_uri`), including quoted values with whitespace/escaped quotes and failing closed on malformed quoting; (2) `Authorization:`/`Cookie:` headers including folded continuations, plus `Bearer`/`Basic` tokens; (3) recognized secret token formats (`sk-…`, `gh[pousr]_…`, JWT); (4) hierarchical or slash-prefixed credential URIs (`postgres://user:pw@host`, `rediss://`, `mongodb+srv://`, `http(s)://`, `jdbc:oracle:thin:user/pw@host:1521:app`, malformed one-slash variants), with every `scheme://` and `scheme:/` URL replaced by `[URL]` (also covers INV-8's provider base URL); (5) query-string credentials (`api_key=`, `access_token=`, `key=`, `secret=`, `token=`).

*Explicit exclusion — outside PI-07's guarantee and tests:* **opaque/rootless URIs whose userinfo is colon-delimited with no `//` root and no `/` separator**, canonically `sip:user:password@example.test`, and the same shape in other rootless schemes (SIP/SIPS, colon-delimited JDBC userinfo variants). `scheme:a:b@c` is syntactically indistinguishable from ordinary prose, so it is not redacted by pattern here. PI-07 does not claim it, does not test it, and a reviewer must not bounce PI-07 for it. **This narrows PI-07 only, not INV-2** — the residual gap is a documented accepted risk recorded under INV-2 in `docs/2026-08-04-flow-ui-and-token-savings.md`. A fail-closed structured-boundary redesign would be a new ticket and is deliberately not attempted now. **Security warning preserved:** never paste raw `.env` files, credential URIs, or provider secrets into prompts; redaction is defense in depth, not permission to be careless.

**Acceptance criteria.**
- Two assemblies with different route decisions produce a byte-identical stable prefix.
- The volatile suffix is the only region that differs, and it appears after the entire stable prefix.
- Changing the user's task text does not change the stable prefix.
- Changing the active stage changes only the volatile suffix.
- Through the production `before_agent_start` seam, a `baseSystemPrompt` containing each supported-boundary form (1)–(5) returns a system prompt with no synthetic credential marker remaining, while ordinary neighboring lines are preserved byte-for-byte (INV-2, INV-8, within the narrowed scope).
- The boundary is observable in the source: `extensions/workflow/prompt-assembly.ts` carries a doc comment stating the supported forms and naming the excluded opaque/rootless colon-delimited userinfo form (`sip:user:password@example.test`) as out of scope, referencing PI-07 and INV-2.
- `extensions/workflow/prompt-assembly.test.ts` contains exactly one explicitly named scope test documenting the exclusion, asserting the excluded form is not part of PI-07's guarantee, so the gap is visible in test output rather than implicit in a missing case.
- Out of criteria (do not add): speculative tests for further URI dialects, SIP/rootless redaction behavior, or any new redaction implementation.

**Verification-command.** `node --test --experimental-strip-types extensions/workflow/prompt-assembly.test.ts extensions/workflow/policy.test.ts && npm run check`

*(Verification-command unchanged by this repair: criteria 5–7 all live in `prompt-assembly.test.ts` and `tsc --noEmit` runs via `npm run check`.)*

**Bounce history and human decision (preserved evidence — do not erase).**
1. Bounce 1 (reviewer): `AWS_ACCESS_KEY_ID=` assignment leaked through the production seam → key matcher + production-seam regression added.
2. Bounce 2 (reviewer): credential-bearing non-HTTP `.env` URLs (`postgres://…`) leaked → `*_URL`/`*_URI` and slash-prefixed URI redaction added.
3. Bounce 3 of 3 (reviewer, budget exhausted): opaque/rootless `jdbc:oracle:thin:user/pw@host` leaked; reviewer reported non-convergence of an absolute boundary enforced by a syntax blacklist and escalated for a human choice (fail-closed structured boundary vs. narrowed criterion).
4. Human-authorized recovery review: closed the Oracle/JDBC slash form; `sip:user:password@example.test` still leaked → escalated again.
5. Human decision (2026-08-04, this repair): narrow the scope as above; do not attempt another redaction implementation now. Reviewer verdicts, handoffs, PR #14, and the existing code remain untouched as evidence.

**Planner repair (2026-08-04).** PI-07 moved out of human-escalated `Reviewing` → `Planned` (repair) → `Agent Ready` on Project #12 (blocker PI-06 is Done). PI-09/#11 left untouched at `Agent Ready`.

---

## PI-08 — Windows support for the whole Pi workflow (INV-7)

Status: **Done** · Blocked-by: PI-07 · Phase 2

**What to build.** Replace the bash+python `install.sh` path with a cross-platform Node installer (`scripts/install.mjs`, invoked by both `install.sh` and a new `install.ps1`) that resolves the agent dir, links or copies resources, and merges settings; make every path join platform-safe; confirm the notification branch degrades cleanly on Windows; and document the Windows setup in `SETUP.md`.

**Acceptance criteria.**
- `node scripts/install.mjs --dry-run --agent-dir <tmp>` exits 0 on the current platform and reports every resource it would link or copy, without modifying the real `~/.pi/agent`.
- Running the installer twice against the same temp agent dir is idempotent: the second run produces the same final settings content as the first.
- When symlink creation fails (simulated), the installer falls back to copying and reports which resources were copied, exiting 0.
- The notification helper returns without throwing when the platform notifier is unavailable, on every platform branch.
- No path in changed code is built by string concatenation with `/`; all use `node:path`.
- `SETUP.md` documents the Windows install command and the fact that `bin/fd` is a platform-specific download, not a committed binary.

**Verification-command.** `node --test --experimental-strip-types extensions/shared/*.test.ts && node scripts/install.mjs --dry-run --agent-dir "$(mktemp -d)" && npm run check && npm test`

**Review (reviewer, 2026-08-04).**
- Verdict: **PASS** (score: 96/100, diagnostic only) · Bounce: 0 of 3.
- Tested commit: `4cfc409a49b4a36adb95b60aef178bfd51a5a38c` over base `8a2d3da45e39ed96e5634b77d904b9e3de36f117`.
- Exact gate passed: 41 targeted tests, dry-run, TypeScript check, 204 Node tests, and 22 Vitest tests; exit 0.
- Static checks passed: `git diff --check`, `npm run format:check`, and `sh -n install.sh`. PowerShell was unavailable on this macOS runner; `install.ps1` was inspected statically.
- Blocking findings: none. Routing: → **Done** — all acceptance criteria and INV-7 hold. Project #12 item read back `Done`.
- Review artifact: `docs/handoffs/2026-08-04-reviewer-pi08.md`.

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

**Verification-command.** `test -f docs/2026-08-04-proxy-evaluation.md && grep -Eq '^Verdict: (adopt|reject|needs a further spike)$' docs/2026-08-04-proxy-evaluation.md && git diff --quiet "$(git merge-base HEAD origin/main)" HEAD -- settings.example.json install.sh SYSTEM.md package.json && npm run check`

The `git diff --quiet` clause is the INV-8 guard: it compares the ticket branch with its `origin/main` merge-base, catching committed routing/config edits.

---

## PI-10 — `/flow` issue todo list with live ticket statuses

Status: **Planned** · Blocked-by: PI-12, PI-13 · Phase 3 · *Amended 2026-08-04 (addendum plan): adds repository, assignee, and honest ETA columns.*

**What to build.** Add an Issues/Todos view to `/flow` that renders the snapshot
produced by PI-13 as one row per ticket: repository · ticket ID · title ·
assignee (owning pipeline role) · pipeline status · blockers · ETA. The view is
read-only: status changes remain explicit workflow actions, and every tracker
read happens off the render path.

**Acceptance criteria.**
- Every ticket in the snapshot appears exactly once, with repository, ID, title, assignee, status, blockers, and ETA fields present (a field with no value renders an explicit placeholder such as `—` or `eta unknown`, never blank-by-omission).
- The assignee is the owning pipeline role (`planner|coder|debugger|reviewer`) derived from status, or the ticket's explicit `Assignee:` field when present; no other role vocabulary appears.
- Blockers render as the blocking ticket IDs plus whether each is satisfied; a ticket whose chain is satisfied is visibly distinguishable from one that is still blocked.
- ETA renders exactly `eta unknown` when PI-13 supplies no estimate, and otherwise renders the range and sample size PI-13 supplied, unchanged (INV-9). The view performs no estimation of its own.
- Planned, ready, active, reviewing, done, dropped, and blocked work are distinguishable without colour (INV-11), verified by rendering with colour disabled.
- A missing, unreadable, or malformed snapshot degrades to a bounded `issue list unavailable — <reason>` line without throwing.
- Every rendered line fits the panel width at widths 40, 80, and 120; user-controlled ticket text is terminal-safe and secret-redacted (INV-2).
- Rendering performs no filesystem, network, or subprocess call, and 1 000 renders at width 120 complete in under 2 000 ms.
- Opening the view never changes a ticket status, never writes the tracker, and never starts work.

**Verification-command.** `node --test --experimental-strip-types extensions/workflow/issue-list.test.ts extensions/workflow/flow-panel.test.ts && npm run check`

---

## PI-11 — Retro-gate the orchestrator-only + honest-telemetry continuation (`bb5d79e`)

Status: **Reviewing** · Blocked-by: none · Phase 3 · Priority 1

**Why this exists.** Commit `bb5d79e` ("fix: keep user messages with orchestrator") is the current HEAD and the current `origin/main`. It removed the workflow `input` steering hook and `canSteerStage`, changed stage-row progress to `<1% ctx`, and made zero Claude usage report unknown — but it has no ticket, no debugger audit, and no reviewer verdict. **The commit is preserved. No reset, rebase, revert, or force-push is authorized.** This ticket retro-gates it forward-only and closes the remaining gaps the user re-reported on 2026-08-04: the Pi `steeringMode` setting and the header `STEER` affordance still imply direct stage steering.

**What to build.** On top of `bb5d79e`: set `steeringMode` in `settings.example.json` to the value that keeps interactive input with the orchestrator (verify the accepted values against the installed Pi runtime before choosing; if no such value exists, document that and keep the extension-level guarantee as the enforcement point); remove the remaining `STEER` label semantics from `extensions/ui-customization/index.ts:169`; add the regression tests that `bb5d79e` did not ship; and state the orchestrator-only rule in `SYSTEM.md`/`README.md` as a hard rule rather than a preference.

**Acceptance criteria.**
- No code path delivers interactive user input to a stage agent: a test asserts the workflow extension registers no `input` handler that returns `{action:"handled"}`, and that the only route to a stage is an explicit `workflow send` tool call made by the orchestrator.
- `settings.example.json` no longer ships `"steeringMode": "all"`; the shipped value keeps user input with the orchestrator, and the chosen value is justified in a comment or in `SETUP.md` against the runtime's accepted values.
- The installed-settings merge in the installer updates an existing `"steeringMode": "all"` to the new value instead of leaving the old one (idempotent on a second run).
- No UI surface shows `STEER` or any other affordance implying the user is typing to a stage; a test asserts the string is absent from rendered header/footer output.
- Claude context occupancy of zero total tokens reports unknown, and a stage row with an unknown reading renders no `%` at all (regression for the user-reported `0%`).
- A measured reading strictly between 0 % and 1 % renders `<1% ctx` and never `0%`.
- `SYSTEM.md` and `README.md` state that Vraj messages only the orchestrator and that stages are addressed solely by relay.
- Full suite stays green: `npm test` exits 0.

**Verification-command.** `node --test --experimental-strip-types extensions/workflow/policy.test.ts extensions/workflow/flow-panel.test.ts extensions/ui-customization/footer.test.ts extensions/subagents/context-usage.test.ts extensions/workflow/config-docs.test.ts && npm run check && npm test`

**Debugger audit (2026-08-04).**

- Starting state was clean commit `3e8ea05ec91f533c45ceda513037d0e81cc32ccd`, with this ticket in `Debugger Ready`. The local tracker is authoritative; no GitHub Project or issue tracker is configured for this repository.
- Red-team probes found real defects: same-second installer backups collided on a repeated run; malformed settings were silently replaced; an in-place repository install could move its own resources and create broken links; malformed or negative Claude token readings could look measured; unknown context text rendered `?%`; and `workflow send` did not reject helper IDs. These were fixed test-first.
- The installer now fails closed for malformed/non-object JSON, migrates legacy `steeringMode: "all"` to `"one-at-a-time"` atomically, uses collision-safe backups, is idempotent with paths containing spaces, and leaves in-place repository resources intact. Relay sends require the active stage ID and blank sends are rejected. Documentation now describes the coordinator-only input path and explicit `workflow send` relay accurately.
- Telemetry now treats zero, negative, non-finite, and malformed Claude usage as unknown; unknown readings omit `%`; measured values between 0% and 1% render `<1% ctx`. Static/UI audits found no implementation `canSteerStage` and no visible `STEER` affordance. `NO_COLOR=1` scoped tests passed.
- Evidence: the exact verification command passed with 57 targeted tests, `npm run check`, 174 full Node tests, and 22 Vitest tests; `npm run format:check` passed; `git diff --check` passed; source audits passed. No PI-16, PI-12, or PI-10 implementation file was changed. No push was performed.
- Routing: **Review Ready**. Handoff: `docs/handoffs/2026-08-04-debugger-pi11.md`.

**Review: FAIL (68/100, diagnostic only) — 2026-08-04.**

- Bounce: **1 of 3**.
- Gate: exact PI-11 verification command → exit 0; format and diff checks → exit 0.
- Blocking correctness: Codex `totalTokens` values of `0` and `-1` pass through `parseThreadTokenUsage` and `buildReading` as measured zero, so stage rows render `0% ctx` instead of unknown with no `%` (`extensions/subagents/src/backends/codex.ts:215`, `extensions/shared/stage-progress.ts:72`, `extensions/ui-customization/footer.ts:165`).
- Blocking correctness: the workflow-stage takeover handles `app.clear` before its stage guard and calls `requestAbort`, so the purported read-only stage view can terminate the stage (`extensions/subagents/src/ui/takeover.ts:451`).
- Routing: **Debugger Ready**. Review: `docs/handoffs/2026-08-04-reviewer-pi11.md`.

**Debugger audit after reviewer bounce 1 (2026-08-04).**

- Starting state: reviewer-bounce commit `7e1b3a2`, local tracker mode, no network or push used. The focused red suite reproduced all three defects: Codex zero occupancy became measured `0%`, direct non-positive context readings were measured, and stage takeover `app.clear` called `requestAbort`.
- Fix: Codex accepts only positive finite `last.totalTokens` and context-window values; shared readings and display validators accept only positive finite occupancy, so zero, negative, non-finite, and missing values become indeterminate and stage rows omit `%`. Positive values remain measured, including `<1% ctx` for tiny positive use.
- Fix: takeover snapshots are classified once per key event. Stage takeovers cannot abort on `app.clear`, send text, or mutate a run; stage close and scroll paths remain active. Helper takeover abort/send behavior remains covered.
- Red-team coverage: Codex zero/negative/non-finite/null/string/object/missing payloads; malformed settings JSON plus `null`, array, number, and string settings preservation; and production takeover clear/scroll/close/helper send-abort paths.
- Evidence: focused red→green suite 27 tests; red-team/settings/UI suite 63 tests; exact PI-11 gate 59 targeted tests + `npm run check` + full `npm test`; final full suite 179 Node tests and 22 Vitest tests, exit 0; `npm run format:check` and `git diff --check` pass. One contention-sensitive full-suite benchmark attempt exceeded its 2 s threshold, then the isolated benchmark and exact full suite passed.
- Routing: **Review Ready**. Handoff: `docs/handoffs/2026-08-04-debugger-pi11-bounce-1.md`.

**Review: FAIL (72/100, diagnostic only) — 2026-08-04.**

- Bounce: **2 of 3**.
- Gate: exact PI-11 verification command → exit 0 (59 targeted tests; 179 Node tests; 22 Vitest tests).
- Prior blockers fixed: Codex invalid/non-positive/non-finite/missing usage and windows become unknown while positive pairs remain measured; stage takeover cannot send or abort while helper send/abort/close and navigation remain available.
- Blocking invariant integrity: `extensions/subagents/src/format.ts:27-30,45-49` still rounds tiny positive context occupancy to `0%`; `{tokens:1, contextWindow:200000}` renders `0%/200k` in stage takeover/dashboard instead of `<1%`, violating PI-11's no-`0%` requirement.
- Routing: **Debugger Ready**. Review: `docs/handoffs/2026-08-04-reviewer-pi11-bounce-2.md`.

**Debugger audit after reviewer bounce 2 (2026-08-04).**

- Reproduced the reported `formatContextUtilization({ tokens: 1, contextWindow: 200_000 })` defect in the direct formatter, dashboard row, and stage takeover header.
- Fixed the shared subagent formatter to preserve positive sub-1% readings and render `<1%/capacity`; valid readings at or above 1% retain integer formatting, while zero/negative/non-finite/missing readings remain `?/capacity` or omitted when capacity is invalid.
- Added direct formatter tests plus dashboard and takeover consumer regressions covering Unicode titles, truncation, visible width, and no `0%`. The existing stage takeover read-only fix remains intact.
- Exact PI-11 gate passed: 60 targeted tests, `npm run check`, 182 full Node tests, and 22 Vitest tests. `npm run format:check` and `git diff --check` also passed.
- Handoff: `docs/handoffs/2026-08-04-debugger-pi11-bounce-2.md`. No push performed; local commit and clean-tree evidence recorded at handoff.
- Routing: **Review Ready**.

**Reviewer final review (2026-08-04): FAIL (70/100, diagnostic only) · Bounce 3 of 3 — HUMAN ESCALATION.**

- Tested commit: `d1893a18d7851352c78ec299f58c2a5adcad4006`.
- Exact gate passed: 60 targeted tests, `npm run check`, 182 full Node tests, and 22 Vitest tests. `npm run format:check`, `git diff --check`, and a 66-test `NO_COLOR=1` run also passed.
- Prior blockers are fixed: orchestrator-only relay, settings migration/idempotence, removal of `STEER`, stage takeover read-only behavior with helper controls preserved, invalid Claude/Codex telemetry as unknown without `%`, and tiny positive telemetry in the subagent formatter/dashboard/takeover.
- New blocking invariant integrity: `extensions/shared/context-utilization.ts:22-26,42-46` renders `{tokens:1, contextWindow:200000}` as `0%/200k`, not `<1%/200k`; the direct probe exited 1 while normal and unknown readings remained accurate.
- Routing: → **Human escalation** — third failed review found a new substantive honest-telemetry failure. PI-11 remains **Reviewing** pending a human decision; it is not bounced into another automatic loop. Review: `docs/handoffs/2026-08-04-reviewer-pi11-bounce-3.md`.

---

## PI-16 — Stage rows explain silence instead of showing a bare number (INV-1, INV-5, INV-6)

Status: **Planned** · Blocked-by: PI-11 · Phase 3 · Priority 2

**Why this exists.** The user observed a planner row reading roughly `15m · 1t · 0%` — fifteen minutes of wall clock, one turn, and a number that reads as "no progress". Elapsed time alone is not a status. A row that cannot say anything useful must say *why*.

**What to build.** Add a bounded `reason` field to the stage row in both the footer and `/flow`, derived only from data already tracked in-process (last status change, last turn timestamp, tool in flight, waiting on question/helper, provider error, spend/quota limit, stale bridge). No new I/O on the render path.

**Acceptance criteria.**
- A stage row whose last update is older than the 30 s staleness window renders the `~` prefix **and** a reason token (for example `~ waiting on provider`), never a bare elapsed/turn pair.
- The reason vocabulary is a closed, tested set; an unrecognised internal state renders exactly `reason unknown`, never a fabricated cause.
- A row with no measured reading renders no `%` character at all (INV-1) and still renders its reason.
- Reason text is truncated to fit, terminal-safe, and secret-redacted (INV-2); a provider error message containing an `Authorization` header renders redacted.
- The reason is legible without colour (INV-11).
- Adding the reason keeps the footer at ≤7 lines and ≤4 stage rows at widths 20, 60, 80, 200 (INV-4), and keeps render under 2 ms at width 200 over 1 000 renders (INV-3).
- A getter that throws while producing a reason still yields the base 3 footer lines (INV-6).

**Verification-command.** `node --test --experimental-strip-types extensions/ui-customization/footer.test.ts extensions/workflow/flow-panel.test.ts && npm run check && npm test`

---

## PI-12 — Retire the header status block; the footer is the single status surface (INV-3, INV-4, INV-11)

Status: **Planned** · Blocked-by: PI-16 · Phase 3

**What to build.** `extensions/ui-customization/index.ts:151-186` renders route, workflow status, active stage, and `N running · N tracked` in the header while the footer renders the same rail. Move every piece of still-wanted status into the persistent footer and remove the header status block, keeping the identity line (π + cwd) wherever the user still needs it.

**Acceptance criteria.**
- The header no longer renders route, workflow status, active stage, or agent counts; a test asserts those tokens are absent from header output.
- Every status token removed from the header is present in footer output for the same state, or is explicitly listed in the ticket's notes as intentionally dropped with a reason — nothing disappears silently.
- The footer still renders exactly 3 base lines with no tracked agents, 5 with 2 stage agents, and 7 with 4 or more (INV-4); the added header content does not push it past 7 lines.
- Every footer line's visible width is ≤ the requested width at widths 20, 60, 80, and 200, with ANSI sequences excluded from the width measurement.
- Percentages remain measured-only (INV-1), stale readings keep the `~` prefix (INV-5), and stage rows keep their PI-16 reason.
- All status meaning survives with colour disabled (INV-11).
- The footer render path performs no filesystem, network, or subprocess call and stays under 2 ms at width 200 over 1 000 renders (INV-3).
- A throw inside any status getter still yields the 3 base lines (INV-6).

**Verification-command.** `node --test --experimental-strip-types extensions/ui-customization/footer.test.ts extensions/ui-customization/header.test.ts && npm run check && npm test`

---

## PI-13 — Tracker snapshot source and honest ETA estimator (pure module, INV-9)

Status: **Planned** · Blocked-by: PI-11 · Phase 3

**What to build.** A pure module `extensions/shared/ticket-snapshot.ts` that parses tracker markdown text (passed in as a string — the module does no I/O) into frozen `TicketRecord`s — `{repo, id, title, status, blockedBy[], assignee, verificationCommand?, updatedAt?}` — resolves blocker satisfaction, and computes an ETA per ticket under INV-9. A separate thin caller performs the file read off the render path and stamps the snapshot with a capture time.

**Acceptance criteria.**
- Parsing the repo's own `tickets.md` yields one record per `## PI-NN` heading, with status, title, and `Blocked-by` list extracted, and `Dropped` tickets marked dropped rather than pending.
- Unknown, missing, or malformed status text yields `status:"unknown"` rather than a guess or a throw; a truncated or empty document yields an empty snapshot plus a reason string.
- `assignee` resolves to the owning role (`planner|coder|debugger|reviewer`) from status, or the explicit `Assignee:` field when present; no other vocabulary can be produced.
- Blocker resolution reports, per ticket, which blockers are satisfied; a cycle in the `Blocked-by` graph is reported as `blocked (cycle)` and never loops or overflows the stack.
- ETA returns `unknown` with fewer than 3 comparable completed samples; with ≥3 it returns a range plus the sample size `n`, derived only from measured completed-stage durations in the snapshot (INV-9). A test asserts no ETA is ever derived from a percentage, a token count, or wall-clock elapsed alone.
- Every returned record and snapshot is frozen, and the input string is not mutated.
- The module imports nothing from `node:fs`, `node:child_process`, or any network API, asserted by reading its own source text.
- Parsing a 10 000-line tracker completes in under 100 ms.

**Verification-command.** `node --test --experimental-strip-types extensions/shared/ticket-snapshot.test.ts && npm run check`

---

## PI-14 — Repository registry and cross-repository task/status view (INV-10)

Status: **Planned** · Blocked-by: PI-10 · Phase 3

**What to build.** A declared repository registry (`workflow.repositories` in settings, defaulting to this repo only — **no filesystem discovery**) plus a cross-repository mode of the Issues/Todos view that merges PI-13 snapshots from each registered repository, grouped by repository, with per-repository health.

**Acceptance criteria.**
- The registry comes only from explicit settings; a test asserts no directory scan or glob of the user's home or work directories occurs.
- With no registry configured, the view shows this repository only and says so, rather than appearing empty.
- Tickets are grouped by repository, and no ticket can render under a repository it did not come from (asserted with two fixtures that share ticket IDs).
- A repository that is missing, unreadable, times out, or has no tracker renders `unavailable — <reason>` for that repository only; the other repositories still render (INV-10).
- Every repository read happens off the render path and carries a capture timestamp; a snapshot older than the staleness window renders with `~` and its age, never as current (INV-5, INV-10).
- The view is read-only across repositories: a test asserts no write, commit, push, or tracker mutation targets any path outside this repository.
- Repository names and ticket text are terminal-safe, secret-redacted, and width-bounded at widths 40, 80, and 120 (INV-2, INV-4).
- Cross-repository rendering performs no filesystem, network, or subprocess call and stays under 2 ms per render at width 120 over 1 000 renders.

**Verification-command.** `node --test --experimental-strip-types extensions/workflow/repo-registry.test.ts extensions/workflow/issue-list.test.ts && npm run check && npm test`

---

## PI-15 — Setup, rollback, and push-proof documentation

Status: **Review Ready** · Blocked-by: PI-08 (Done) · Phase 2

**Why this exists.** `README.md` claims the installer "backs up current runtime resources", but `SETUP.md` (36 lines) documents no way to restore them, and no Windows path. Push proof itself already exists — `origin/main` and local `HEAD` are both `bb5d79e` — so this ticket documents how to reproduce that proof, and claims no new push.

**What to build.** Extend `SETUP.md` with an install → verify → rollback lifecycle, and a short "proving a push landed" section.

**Acceptance criteria.**
- `SETUP.md` documents the install command for macOS/Linux and for Windows (PowerShell), consistent with the PI-08 installer.
- `SETUP.md` documents exactly where backups are written, how to list them, and a copy-pasteable rollback procedure that restores the previous `~/.pi/agent` state; the procedure is verified by running install → rollback against a temp agent dir and asserting the directory content matches the pre-install state byte-for-byte.
- The rollback section states what rollback does **not** restore (for example `auth.json`, `models.json`, and session data) rather than implying a total restore.
- A "push proof" section shows the exact commands that establish a push landed (`git rev-parse HEAD` and `git ls-remote origin <branch>` compared), and states that a handoff may not claim a push without that comparison.
- No credential, token, or key appears in any added text; the remote is referenced by URL only.
- The ticket changes only documentation and installer test fixtures: `git diff --stat` shows no change under `extensions/`.

**Verification-command.** `test -f scripts/install-rollback.test.mjs && node --test --experimental-strip-types extensions/workflow/config-docs.test.ts scripts/install-rollback.test.mjs && npm run check`

(The leading `test -f` is load-bearing: `node --test` silently ignores a missing file path and exits 0, so without it the gate is green before any work is done. Verified red today: exit 1.)

---

## PI-17 — Explicit direct conversation from an opened stage view

Status: **Planned** · Blocked-by: PI-11 · Phase 3

**What to build.** Keep the main chat permanently orchestrator-only, while allowing deliberate direct conversation only after the user explicitly opens a stage's subagent view. The stage view must expose a clear input affordance and never capture ambient main-chat input.

**Acceptance criteria.**
- Main-chat interactive input is never delivered to a stage; only the explicit stage-view send action may target the selected stage.
- The opened stage view clearly identifies the destination and supports send, cancel, and bounded error handling; no hidden or automatic forwarding exists.
- Opening, closing, scrolling, or typing outside the explicit stage input cannot mutate a stage run.
- Helper takeover behavior remains unchanged, and workflow-stage messages cannot use the generic helper relay.
- Tests cover the main-chat boundary, explicit stage-view send, helper behavior, stage identity checks, terminal-safe/redacted text, and width bounds.

**Verification-command.** `node --test --experimental-strip-types extensions/workflow/policy.test.ts extensions/subagents/takeover.test.ts extensions/subagents/manager.test.ts && npm run check && npm test`
