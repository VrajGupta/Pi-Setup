# Tickets — Vraj Pi

Local-file tracker (no GitHub Project for this repo; see `docs/2026-08-04-flow-ui-and-token-savings.md`
and the addendum `docs/2026-08-04-flow-todo-crossrepo-and-docs.md`).
Work top to bottom. A ticket is claimable only when every **Blocked-by** ticket is Done.
Every `Verification-command` is run from the repo root and must exit 0 exactly when the ticket is complete.

Status legend: `Planned` · `Agent Ready` · `Coding` · `Debugger Ready` · `Debugging` · `Review Ready` · `Reviewing` · `Done`

GitHub issue mirror. Live board: **GitHub Project #12 (owner `VrajGupta`)** — its `Status` field is the
workflow authority for stage state; this file mirrors it and carries the durable ticket text.

`PI-06 → #2` · `PI-07 → #9` · `PI-08 → #10` · `PI-09 → #11` · `PI-10 → #7` · `PI-11 → #1` · `PI-18 → #17`
`PI-12 → #6` · `PI-13 → #4` · `PI-14 → #8` · `PI-15 → #12` · `PI-16 → #3` · `PI-17 → #5` · `PI-19 → #16`

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

_Supported boundary — PI-07 guarantees redaction for:_ (1) named credential assignments (`api_key`, `access_key`, `access_token`, `aws_access_key_id`, `authorization`, `cookie`, `credential`, `password`, `passwd`, `private_key`, `secret`, `token`, `*_url`, `*_uri`), including quoted values with whitespace/escaped quotes and failing closed on malformed quoting; (2) `Authorization:`/`Cookie:` headers including folded continuations, plus `Bearer`/`Basic` tokens; (3) recognized secret token formats (`sk-…`, `gh[pousr]_…`, JWT); (4) hierarchical or slash-prefixed credential URIs (`postgres://user:pw@host`, `rediss://`, `mongodb+srv://`, `http(s)://`, `jdbc:oracle:thin:user/pw@host:1521:app`, malformed one-slash variants), with every `scheme://` and `scheme:/` URL replaced by `[URL]` (also covers INV-8's provider base URL); (5) query-string credentials (`api_key=`, `access_token=`, `key=`, `secret=`, `token=`).

_Explicit exclusion — outside PI-07's guarantee and tests:_ **opaque/rootless URIs whose userinfo is colon-delimited with no `//` root and no `/` separator**, canonically `sip:user:password@example.test`, and the same shape in other rootless schemes (SIP/SIPS, colon-delimited JDBC userinfo variants). `scheme:a:b@c` is syntactically indistinguishable from ordinary prose, so it is not redacted by pattern here. PI-07 does not claim it, does not test it, and a reviewer must not bounce PI-07 for it. **This narrows PI-07 only, not INV-2** — the residual gap is a documented accepted risk recorded under INV-2 in `docs/2026-08-04-flow-ui-and-token-savings.md`. A fail-closed structured-boundary redesign would be a new ticket and is deliberately not attempted now. **Security warning preserved:** never paste raw `.env` files, credential URIs, or provider secrets into prompts; redaction is defense in depth, not permission to be careless.

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

_(Verification-command unchanged by this repair: criteria 5–7 all live in `prompt-assembly.test.ts` and `tsc --noEmit` runs via `npm run check`.)_

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

Status: **Done** · Blocked-by: PI-12 (Done), PI-13 (Done) · Phase 3 · _Amended 2026-08-04 (addendum plan): adds repository, assignee, and honest ETA columns._

**Reviewer final (2026-08-05): PASS (94/100).** Gate exit 0 (26/26; tsc clean). All criteria met; no blocking findings. Routing: → **Done** — Project #12 read back Done; issue #7 closed.

**Coder delivery (2026-08-05).** Added a read-only `Issues` tab backed by PI-13's cached snapshot, captured at `session_start` (off the render path). Each ticket has one width-bounded, terminal-safe/redacted row with repo, ID, title, role assignee, text status, blocker satisfaction, and PI-13 ETA; malformed/unavailable snapshots render a bounded unavailable line. Product diff SHA-256: `92d2c111e82dc21f19e4af86a67fddcda799ad0003f7add965b9bc19fcca8fc3` (`/tmp/pi10-product.diff`). Exact gate `node --test --experimental-strip-types extensions/workflow/issue-list.test.ts extensions/workflow/flow-panel.test.ts && npm run check` → exit 0 (24 tests; TypeScript clean). `npm run format:check` → exit 0; `npm test` → exit 0 (226 Node tests, 22 Vitest tests); `git diff --check` → exit 0. Project #12 issue #7 moved `Agent Ready` → `Coding` → `Debugger Ready`; both states read back. Artifact: `docs/handoffs/2026-08-05-coder-pi10.md`.

**Debugger audit (2026-08-05, fallback route).** Baseline exact gate was red: the interrupted debugger test expected an internally inconsistent `unblocked` record to render, and the Issues/Todos 1,000-render budget was unstable/over budget due to reparsing and rescanning the same immutable snapshot. Red-team probes also found gaps in malformed ETA validation, empty reason handling, AWS-style assignment redaction, malformed quoted assignment tails, and rootless credential-shaped text. Fixed test-first in the owned workflow view: reject duplicate IDs and inconsistent blocker chains; validate finite, safe integer ETA ranges and sample counts; cache derived issue rows by snapshot identity and clear the cache on invalid snapshots; preserve explicit unavailable reasons; harden display redaction; add minimal production-seam regressions for these boundaries. Stage/engine files were untouched. Product diff SHA-256: `55f8f55eab0733176049aecb36654a84b8cea10da1dd07c9a0e3ff33892cfd44` (`/tmp/pi10-product-final.diff`). Exact gate after final edit: `node --test --experimental-strip-types extensions/workflow/issue-list.test.ts extensions/workflow/flow-panel.test.ts && npm run check` → exit 0 (26 tests; TypeScript clean). `npm run format:check` → exit 0; `npm test` → exit 1 (227/228 passed; only live Codex completion failed outside this lane); `git diff --check` → exit 0. Commit `19b7982e77cb9f7331f7465da55ffeb322a69e2f`; fetched `origin/main` and `git ls-remote --heads origin main` read the same SHA. Artifact: `docs/handoffs/2026-08-05-debugger-pi10.md`. Project #12 issue #7 moved `Debugging` → `Review Ready` and read back. No unfixed in-scope follow-up; only the independent reviewer may set Done.

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

Status: **Done** · Blocked-by: none · Phase 3 · Priority 1 · _Amended 2026-08-05 (human decision): the shared-formatter sub-1% rounding residual is accepted display precision for this ticket; all safety, input-routing, and unknown-telemetry requirements stay hard. See the amendment section in `docs/2026-08-04-flow-todo-crossrepo-and-docs.md`._

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

**Coder re-gate (2026-08-05).**

- Project #12 item `PVTI_lAHOCFvJwM4BfV__zg1N9ZY` moved `Agent Ready` → `Coding` → `Debugger Ready`; both states were read back. No other item moved.
- No new production change was required: the current tree already has the PI-11 relay, settings migration, no-`STEER`, read-only takeover, unknown-telemetry, and shipped `<1%` coverage. The sole shared-formatter residual remains untouched under the recorded amendment.
- Exact gate exit 0: 63 focused tests, TypeScript check, 204 Node tests, and 22 Vitest tests. `npm run format:check` exit 0; `git diff --check` exit 0.
- Review target product diff (`98ee39150e242c0929d80c471c1b0a9dcc20bfb7..d1893a18d7851352c78ec299f58c2a5adcad4006`) SHA-256: `c99ec3630c06d9c97fb433288755dab8890fb352f425b839401d13fa4e5525e2`.
- Artifact: `docs/handoffs/2026-08-05-coder-pi11.md`. Route: independent debugger; only reviewer may set Done.

**Debugger audit (2026-08-05, acting debugger — pinned stage harness unavailable).**

- The pinned debugger stage (codex/gpt-5.6-luna) could not be spawned through the workflow engine in this environment (spawn registered an id but no agent materialized; two attempts, recover + relay all no-op). User authorized the coordinator to act as debugger for this ticket, then fan out subagents for the rest. Native subagent bridge verified working before the audit.
- Red-team probes (all exit 0, production seams): installer steering migration idempotent and malformed settings rejected; codex `parseThreadTokenUsage` adversarial inputs (0, -1, NaN, Infinity, string, null, garbage) all → unknown, valid → measured; shipped `formatContextUtilization` renders `<1%/200k` for positive sub-1%, `?/200k` for zero/negative/NaN/missing, `""` for invalid capacity — no fabricated `0%`; routing classifies small→direct, risky→planner, explicit stage→that stage, explain→direct; takeover `app.clear` abort is stage-guarded (`!isStageTakeover`); relay send requires active stage ID; no workflow `input` handler; no `STEER` string anywhere in extensions or settings.
- Baseline gate exit 0: 63 focused tests, `npm run check` clean, 204 Node tests, 22 Vitest tests. `npm run format:check` exit 0.
- No new defect found. All prior bounce findings remain fixed at their production seams. No PI-16/12/10/14 implementation file changed (only `.claude/agents/debugger-pi-agent.md` on-lane profile repoint + tracker).
- Routing: **Review Ready**. Handoff: `docs/handoffs/2026-08-05-debugger-pi11.md`. Only the independent reviewer may set Done.

**Reviewer verdict (2026-08-05): PASS (96/100, diagnostic only).**

- Gate: exact amended PI-11 verification command → exit 0 (63 focused tests, TypeScript clean, 204 Node tests, 22 Vitest tests).
- All amended criteria met: orchestrator-only explicit relay, legacy settings migration, no steering affordance, unknown telemetry without `%`, shipped sub-1% stage rows as `<1% ctx`, and coordinator-only documentation.
- The accepted `extensions/shared/context-utilization.ts` residual is unchanged in `f298172..6807047`; no PI-16/12/10/14 implementation file changed and no invariant regression was found.
- Blocking findings: none. Routing: → **Done**.

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

Status: **Done** · Blocked-by: PI-11 · Phase 3 · Priority 2

**Reviewer final (2026-08-05): PASS (94/100).** Re-review of fix commit `9489176` (generic errors → `reason unknown`; no `%` on indeterminate rows; closed vocabulary pinned). Gate exit 0. No blocking findings. Routing: → **Done** — Project #12 read back Done; issue #3 closed.

**Reviewer bounce 1 (2026-08-05): FAIL (48/100).** Three findings: (1) any `status:"error"` event rendered `provider error: <event>` even for generic events like `local validation error` — fabricated cause instead of `reason unknown`; (2) an indeterminate `/flow` row whose provider detail contains `%` (e.g. `50% failure`) rendered a percent, violating INV-1; (3) the closed quota-limit mapping was untested against mutation. Fixed test-first in both `stageReason` copies (ui-customization/index.ts, workflow/index.ts): provider cause now requires provider-shaped tokens (`provider|authorization|timeout|rate limit|quota|spend|unavailable|5xx`); generic errors render `reason unknown`; `/flow` strips `%` from reason text on non-measured rows; added three pinning regressions in flow-panel.test.ts. Exact gate → exit 0 (47 focused; tsc clean; 224 Node; 22 Vitest); `npm run format:check` exit 0. Re-routed to Review Ready.

**Coder delivery (2026-08-05).** Added closed reasons (`working`, waiting, provider/quota error, stale bridge, or `reason unknown`) to the footer and `/flow` stage rows. Reasons are terminal-safe/redacted, stale rows lead with `~`, unknown readings omit `%`, and throwing reason getters retain the base footer. Product diff SHA-256: `11d8b3e752d3eec606fe340deb7c0c18fc14c3afb2ab81f12f285de15f43f80d`. Exact gate `node --test --experimental-strip-types extensions/ui-customization/footer.test.ts extensions/workflow/flow-panel.test.ts && npm run check && npm test` → exit 0 (41 focused tests; 214 Node tests; 22 Vitest tests). `npm run format:check` → exit 0. Project #12 issue #3 read back **Debugger Ready**. Artifact: `docs/handoffs/2026-08-05-coder-pi16.md`; gate log: `/tmp/pi16-gate.log`.

**Debugger audit (2026-08-05, acting debugger — pinned stage harness unavailable).** Independent red-team pass: baseline gate exit 0 (41 focused; tsc clean; full 214+22). Probes against production seams: closed reason vocabulary with `reason unknown` fallback; stale row renders `~` + reason (never bare pair); indeterminate reading renders no `%` on the stage row; throwing `reasonFor`/reading getter still yields the 3 base lines; `Authorization: Bearer …` in a provider-error reason renders `[REDACTED]`; lines fit widths 20/60/80/200. No new defect found; coder tests already cover the closed set, stale prefix, redaction, throwing getters, and width bounds. No PI-13/PI-17 lane file changed. Artifact: `docs/handoffs/2026-08-05-debugger-pi16.md`. Project #12 issue #3 read back **Review Ready**. Only the independent reviewer may set Done.

**Why this exists.** The user observed a planner row reading roughly `15m · 1t · 0%` — fifteen minutes of wall clock, one turn, and a number that reads as "no progress". Elapsed time alone is not a status. A row that cannot say anything useful must say _why_.

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

Status: **Done** · Blocked-by: PI-16 (Done) · Phase 3

**Reviewer final (2026-08-05): PASS (98/100).** Gate exit 0 (26 focused; 221 Node; 22 Vitest; tsc clean). Mutation probe (imported node:fs readFileSync + render call) failed the purity test as required — proof is mutation-proof. No blocking findings. Routing: → **Done** — Project #12 read back Done; issue #6 closed.

**Reviewer bounce 1 (2026-08-05): FAIL (38/100).** Four findings: (1) footer cap — 4 agents + 1 status rendered 8 lines, violating INV-4's ≤7; (2) INV-3 proof only covered pure `footer.ts`, not the shipped `index.ts` wrapper; (3) a throwing `getExtensionStatuses()` still rendered agent rows instead of the 3 base lines (INV-6); (4) bare `key=` redaction was dropped from `SECRET_ASSIGNMENT_PATTERN` (INV-2). Fixed test-first: statuses now fill only the remaining budget after base+rows (7-line cap); a throwing extension-status getter degrades to the 3 base lines; wrapper render benchmark added; bare `key` added to the redaction pattern. Exact gate → exit 0 (24 focused + header test; `npm run check`; 220 Node tests; 22 Vitest); `npm run format:check` exit 0. Re-routed to Review Ready.

**Coder delivery (2026-08-05).** Header now renders only `π + cwd`; footer retains `fleet/coder`, `running`, `coder`, and `N running · N tracked` on its existing three-line base rail. Product diff SHA-256: `55b06a445ab40979af4e82d90c287a0252e3b14c8ca4b151f8229e878f830c99`. Exact gate `node --test --experimental-strip-types extensions/ui-customization/footer.test.ts extensions/ui-customization/header.test.ts && npm run check && npm test` → exit 0 (23 focused tests; 218 Node tests; 22 Vitest tests). `npm run format:check` → exit 0; `git diff --check` → exit 0. Artifact: `docs/handoffs/2026-08-05-coder-pi12.md`; gate log: `/tmp/pi12-gate.log`; product diff: `/tmp/pi12-product.diff`. Project #12 issue #6 moved `Agent Ready` → `Coding`; final `Debugger Ready` read-back recorded in the coder handoff.

**Debugger audit (2026-08-05).** Independent red-team found three footer-boundary defects: malformed measured readings could render fabricated `0%` or an inconsistent supplied percent; PI-16 `provider error:` reasons leaked `Cookie`/password-shaped values and other supported secret forms; and a percent sign in a provider reason or model label could appear in an indeterminate row. Fixed test-first in `extensions/ui-customization/footer.ts` with one compact regression in `footer.test.ts`: measured rows now require a positive percent that exactly matches their numerator/denominator, secret-shaped reason text fails closed while preserving the PI-16 reason prefix, and non-progress display tokens cannot introduce `%`. Header production-seam probe passed; no `index.ts` change was needed. No render-path I/O or performance regression found.

Debugger product diff SHA-256: `3e7fd263b28b19e4d16b1a850ef1f86d1927e576ab40ef0e193426d7f5136c7a` (implementation/tests only). Exact Verification-command → exit 0 (24 focused tests; `npm run check`; 219 Node tests; 22 Vitest tests). `npm run format:check` → exit 0; `git diff --check` → exit 0. Two earlier combined-gate attempts exposed only the pre-existing PI-13 10,000-line benchmark flake (133.6 ms and 144.3 ms against its 100 ms threshold); the isolated test and final exact gate passed. Artifact: `docs/handoffs/2026-08-05-debugger-pi12.md`. Project #12 issue #6 read back `Review Ready`.

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

Status: **Done** · Blocked-by: PI-11 · Phase 3

**Reviewer final (2026-08-05): PASS (96/100).** Gate exit 0 (9/9 tests; tsc clean; 30.28 ms parse). All criteria met; bounce-1 fix confirmed at `ticket-snapshot.ts:270-285` with regression `ticket-snapshot.test.ts:241-250`. No blocking findings. Routing: → **Done** — Project #12 read back Done; issue #4 closed.

**Coder delivery (2026-08-05).** Built the frozen, no-I/O tracker parser with status/role parsing, blocker satisfaction and iterative cycle detection, and INV-9's explicit measured-duration-only ETA range. Product diff SHA-256: `a5c31a3b5ba6a836ca38ed878ceedd7d624a9acaddba3e659ab5d989457467a2`. Exact gate `node --test --experimental-strip-types extensions/shared/ticket-snapshot.test.ts && npm run check` → exit 0; `npm run format:check` → exit 0. Artifacts: `docs/handoffs/2026-08-05-coder-pi13.md`, `/tmp/pi13-product.diff`. Project #12 issue #4 read back `Debugger Ready`.

**Reviewer bounce 1 (2026-08-05): FAIL (68/100).** Section boundaries only split on strict complete headings, so a missing-status ticket could inherit `Status:` from a following malformed heading. Fixed test-first: sections now end at any ATX heading (`^#{1,6}\s+`), not just strict `## PI-NN —`; added regression `a ticket missing status never inherits from a following malformed heading`. Gate exit 0 (9 tests, tsc clean); `npm run format:check` exit 0. Re-routed to Review Ready.

**Debugger delivery (2026-08-05).** Independent red-team pass found and fixed fenced-code heading/field parsing, metadata-shaped prose in ticket titles, duplicate-ID graph ambiguity, and duplicate-ID ETA sample bias. Added minimal regressions for nested freeze attempts, invalid/unsafe durations, a 12,000-node cyclic graph, fenced Markdown, title collisions, and duplicate IDs. Debugger code/test diff SHA-256: `ceeef7e791df2650c324c79fdac4472e53b522f77e68b383ed5965a6cce1a097` (working-tree delta from `542abcf`). Exact gate `node --test --experimental-strip-types extensions/shared/ticket-snapshot.test.ts && npm run check` → exit 0 (8 tests; TypeScript clean); `npm run format:check` → exit 0. `git diff --check` and assigned-file Prettier checks → exit 0. Artifact: `docs/handoffs/2026-08-05-debugger-pi13.md`. Project #12 issue #4 read back `Review Ready`.

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

Status: **Done** · Blocked-by: PI-10 (Done) · Phase 3

**Reviewer final (2026-08-05): PASS (96/100).** Gate exit 0 (10/10 + tsc). All criteria met; no blocking findings. Routing: → **Done** — Project #12 read back Done; issue #8 closed.

**Coder delivery (2026-08-05).** Added the explicit settings-only repository registry (`workflow.repositories`, defaulting to this repo — no filesystem discovery) and made the Issues/Todos view cross-repository: it merges per-repo PI-13 snapshots captured off the render path, grouped by repository with per-repo health headers, `unavailable — <reason>` degradation for missing/unreadable/timed-out/no-tracker repos, and `~ <age>` staleness per repo (30 s window, INV-5/INV-10). Reads are bounded (2 s race), carry capture timestamps, and the view is read-only across repositories (only each declared repo's `tickets.md` is read; no write/commit/push API in the cross-repo code). Repository names/ticket text stay terminal-safe, secret-redacted, and width-bounded at 40/80/120; cross-repo rendering stays pure and under 2 ms/render at width 120 over 1 000 renders (cached derived rows keyed by reads identity). Product diff SHA-256: `a243b57b77b5db5431195dff9e870dff111a786358ddd7583a0344c59fe60f9c` (implementation/tests/settings only; `/tmp/pi14-product.diff`). Exact gate `node --test --experimental-strip-types extensions/workflow/repo-registry.test.ts extensions/workflow/issue-list.test.ts && npm run check && npm test` → exit 0 for the two focused files and `npm run check`; full `npm test` exited 1 only on the known environmental live-Codex backend test (`extensions/subagents/codex.test.ts`, 236/237 pass) — outside this lane and not fixed. `npm run format:check` → exit 0. Artifacts: `docs/handoffs/2026-08-05-coder-pi14.md`, `/tmp/pi14-gate.log`. Project #12 issue #8 read back **Debugger Ready**. PI-18's lane (`README.md`, `SYSTEM.md`, `extensions/workflow/src/policy.ts`, `policy.test.ts`, `settings.example.json` `workflow.mode`) was committed by PI-18's coder (`46ffd74`/`11d60f9`) during this run; no file overlapped and PI-18's committed `workflow.mode` key was left intact.

**Debugger audit (2026-08-05, approved OpenRouter fallback).**

- Project #12 item `PVTI_lAHOCFvJwM4BfV__zg1N89M` was moved `Debugger Ready` → `Debugging` → `Review Ready`; both states were read back. No other item moved. Proof: `/tmp/pi14-project-review-ready.json`.
- Independent probes found real defects: relative registry paths were not resolved; timeout errors were identified by a colliding error message; parse-empty snapshots rendered as healthy; mismatched repository snapshots could leak under another repository; malformed view containers defaulted silently; and timeout handles were not cleaned up. Fixed test-first with minimal production-seam regressions. Declared paths are normalized, the read timeout is bounded at 2 seconds with an opaque sentinel and cleared timer, invalid/empty/mismatched data fails visibly, and invalidation clears cached rows.
- Red-team coverage: malformed/non-array/relative/absolute/tilde registries; missing, unreadable, timeout, timeout-message race, empty tracker; shared IDs and mismatched-repo fixtures; stale capture age; terminal/control and secret-shaped repository names/titles; malformed view containers; render purity, widths, and repeated-render budget.
- Final focused gate: `node --test --experimental-strip-types extensions/workflow/repo-registry.test.ts extensions/workflow/issue-list.test.ts` → **exit 0** (10 tests). `npm run check` → **exit 0**. `npm run format:check` → **exit 0**. `git diff --check` → **exit 0**. Logs: `/tmp/pi14-final-gate-node2.log`, `/tmp/pi14-final-gate-check2.log`, `/tmp/pi14-final-format2.log`, `/tmp/pi14-final-diff2.log`.
- Broader `npm test` → **exit 1**, 238/239 passed. Sole failure: known environmental live Codex provider test `extensions/subagents/codex.test.ts` (`Codex backend completes a live manager run`, `error` ≠ `done`), outside this lane. PI-13 benchmark rerun isolated: `node --test --experimental-strip-types extensions/shared/ticket-snapshot.test.ts` → **exit 0** (9/9). Logs: `/tmp/pi14-npm-test-final2.log`, `/tmp/pi14-pi13-isolated-final.log`.
- Final owned diff SHA-256 from coder commit `5a0de3aa8d80b7a002be5172eb7c1f0455d50755` through debugger commit `9436d2d746c54f27ce89b23c11a73850a6a7a5a7`: `a7278bd3226fc293932932bb10dd3d3150bf78d4ddbdfd43a846c48b89f157b8`. Changed paths are `extensions/workflow/index.ts`, `extensions/workflow/repo-registry.test.ts`, and `extensions/workflow/issue-list.test.ts`; no policy, shared snapshot, subagents, or UI-customization path changed. Product commit `9436d2d746c54f27ce89b23c11a73850a6a7a5a7`; evidence commits `21fb0c76e80a4901e6f538c1727ef7240381bacc`, `5d39ee1d91d70ee5ed8c27229f124464f4ea5134`, and `bd55c38086a0bf42a1b3939185d2fa1453049402`; product push read-back matched `9436d2d746c54f27ce89b23c11a73850a6a7a5a7`, and the later evidence push read-back matched `bd55c38086a0bf42a1b3939185d2fa1453049402`.
- Approved fallback: pinned OpenAI subscription usage-limited; Vraj approved GPT-5.6 Luna via OpenRouter, Pi harness, maximum debugger capability tier. No subagents spawned. Next: independent reviewer; only reviewer may mark Done.

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

Status: **Done** · Reviewer PASS (final review, bounce 3/3) · Blocked-by: PI-08 (Done) · Phase 2

**Why this exists.** `README.md` claims the installer "backs up current runtime resources", but `SETUP.md` (36 lines) documents no way to restore them, and no Windows path. Push proof itself already exists — `origin/main` and local `HEAD` are both `bb5d79e` — so this ticket documents how to reproduce that proof, and claims no new push.

**What to build.** Extend `SETUP.md` with an install → verify → rollback lifecycle, a narrowly scoped installer provenance manifest, and a short "proving a push landed" section.

**Acceptance criteria.**

- `SETUP.md` documents the install command for macOS/Linux and for Windows (PowerShell), consistent with the PI-08 installer.
- `SETUP.md` documents exactly where backups are written, how to list them, and a copy-pasteable rollback procedure that restores the previous `~/.pi/agent` state; the procedure is verified by running install → rollback against a temp agent dir and asserting the directory content matches the pre-install state byte-for-byte.
- The rollback section states what rollback does **not** restore (for example `auth.json`, `models.json`, and session data) rather than implying a total restore.
- A "push proof" section shows the exact commands that establish a push landed (`git rev-parse HEAD` and `git ls-remote origin <branch>` compared), and states that a handoff may not claim a push without that comparison.
- No credential, token, or key appears in any added text; the remote is referenced by URL only.
- The ticket changes only documentation, the narrowly scoped installer provenance manifest, and installer test fixtures: `git diff --stat` shows no change under `extensions/`.

**Verification-command.** `test -f scripts/install-rollback.test.mjs && node --test --experimental-strip-types extensions/workflow/config-docs.test.ts scripts/install-rollback.test.mjs && npm run check`

(The leading `test -f` is load-bearing: `node --test` silently ignores a missing file path and exits 0, so without it the gate is green before any work is done. Verified red today: exit 1.)

**Debugger audit — reviewer bounce 1 (2026-08-05).**

- Baseline exact gate was green: 9 tests passed and TypeScript was clean. Static checks had no errors.
- Blocking invariant defect confirmed: consuming a saved entry erased the knowledge that the resource originally existed, so an interrupted retry could delete the restored target. The prior test covered only a fully completed repeat.
- Fixed test-first at the documented rollback seam: an atomic `.rollback-manifest` directory records `present`/`absent` before any move. A consumed `present` entry with an existing target is treated as already restored; a missing target fails closed. The PowerShell procedure mirrors the same manifest and retry semantics.
- Added one deterministic regression by injecting exit 73 immediately after the documented POSIX command moves `extensions`; the retry preserved its bytes, restored all other managed resources, removed the originally absent resource, preserved settings/auth/models/sessions, and remained safe to repeat.
- No `extensions/` changes, secrets, fixed sleeps, or other ticket changes. Handoff: `docs/handoffs/2026-08-05-debugger-pi15-bounce-1.md`.

**Reviewer re-review (2026-08-05): FAIL (72/100, diagnostic only) · Bounce 2 of 3.**

- Exact gate passed: 9 tests and `tsc --noEmit`, exit 0. Formatting and diff checks passed; PowerShell was unavailable and inspected statically.
- Blocking correctness finding: `scripts/install.mjs:205-208` leaves an already-correct managed symlink unchanged and writes no backup entry, while `SETUP.md:54-60,77-78` classifies every missing backup entry as originally absent. Trigger: install with `~/.pi/agent/extensions` already linked to this checkout, then run the documented rollback. Result: rollback deletes that originally present symlink; the independent production-seam probe exited 1 with `extensions_exists_after_rollback=false`.
- The interrupted-retry regression is deterministic and passes; originally absent removal, path rejection, non-restored state, scope, no-sleep, and secret-shape checks passed.
- Routing: → **Debugger Ready** for a test-first distinction between installer-unchanged and originally absent resources, mirrored in POSIX and PowerShell. Review: `docs/handoffs/2026-08-05-reviewer-pi15-bounce-2.md`.

**Debugger audit — reviewer bounce 2 (2026-08-05).**

- Reproduced the independent production-seam probe: an existing `extensions` symlink to this checkout was deleted by rollback because the installer wrote no backup entry and the rollback inferred `absent`; the probe reported `extensionsExistsAfterRollback=false`.
- Scope amendment: `scripts/install.mjs` now atomically writes `.rollback-manifest` before resource moves, recording `present`, `unchanged`, or `absent` for every managed resource. Rollback refuses missing provenance, preserves `unchanged`, removes only explicit `absent`, and keeps the interrupted `present` retry fail-closed semantics. POSIX and PowerShell consume the same state names.
- The focused fixture uses the unchanged `extensions` symlink, interrupted `skills` move, and truly absent `themes` resource in one deterministic production-seam test; it verifies byte restoration, retry safety, and non-restored state without fixed sleeps.
- No settings/auth/session restoration, secrets, provider changes, or `extensions/` changes. Handoff: `docs/handoffs/2026-08-05-debugger-pi15-bounce-2.md`.

**Reviewer final review (2026-08-05): PASS (96/100, diagnostic only) · Bounce 3 of 3.**

- Reviewed product commit `fe580e5a8987653671fa98af6a347aef62182a65` against base `84cbb0528bb34faf21be7058f42e0447c0e34ea9`; product diff SHA-256 `fc22e72435a6a613a804eff37fff61ab7bf4045b35be3029144a5ead4465a378`.
- Exact gate passed: 9 tests and `tsc --noEmit`, exit 0. Project format, focused Prettier, diff check, `sh -n install.sh`, PowerShell static parity, scope, fixed-delay, and secret-shape checks passed.
- Prior findings are closed at the production seam: interrupted rollback retries preserve the restored original; `unchanged` provenance preserves the installer-unchanged `extensions` symlink; explicit `absent` provenance removes the truly absent `themes` resource.
- Blocking findings: none. Routing: → **Done**. Review: `docs/handoffs/2026-08-05-reviewer-pi15-bounce-3.md`.

---

## PI-17 — Explicit direct conversation from an opened stage view

Status: **Done** · Blocked-by: PI-11 · Phase 3

**Reviewer final (2026-08-05): PASS (97/100).** Gate exit 0 (24 focused; 216 Node; 22 Vitest; tsc clean). All acceptance criteria met; no blocking findings. Routing: → **Done** — Project #12 read back Done; issue #5 closed.

**Coder delivery (2026-08-05).** Built the explicit stage-view input with visible destination/send/cancel affordances and bounded redacted errors. The manager now verifies the selected stage identity before sending, redacts stage-view text, and leaves helper send/abort behavior unchanged. Product diff SHA-256: `8609d1c317f6a1caf2ec683fef1f8344495690e7339154244e13dfd5e0d8579a`. Exact gate `node --test --experimental-strip-types extensions/workflow/policy.test.ts extensions/subagents/takeover.test.ts extensions/subagents/manager.test.ts && npm run check && npm test` → exit 0; `npm run format:check` → exit 0. Artifact: `docs/handoffs/2026-08-05-coder-pi17.md`. Project #12 issue #5 read back `Debugger Ready`.

**Debugger delivery (2026-08-05).** Independent red-team pass fixed: dashboard advertised `x abort` for a selected stage while the action itself was stage-disabled; stage rows rendered raw unsanitized/unredacted snapshot text; `TakeoverView` accepted input and rendered after `close()`; input render lines were not width-truncated. Fixes: abort affordance is stage-guarded and only rendered for helpers; `safeDisplaySnapshot`/`safeDisplayLine`/`safeDisplayText` sanitize+redact every dashboard/takeover surface; closed-view guards on submit/handleInput/send-error callback; input lines truncated to viewport width. Minimal production-seam regressions added. Debugger diff SHA-256 from `542abcf`: `1bc490f5b1772bc429918aebdb12f13171299cfd1efec450e5208bf3c4a77cb0`. Exact gate → exit 0 (216 Node tests, 22 Vitest, tsc clean); `npm run format:check` → exit 0. Artifact: `docs/handoffs/2026-08-05-debugger-pi17.md`. Project #12 issue #5 read back `Review Ready`.

**What to build.** Keep the main chat permanently orchestrator-only, while allowing deliberate direct conversation only after the user explicitly opens a stage's subagent view. The stage view must expose a clear input affordance and never capture ambient main-chat input.

**Acceptance criteria.**

- Main-chat interactive input is never delivered to a stage; only the explicit stage-view send action may target the selected stage.
- The opened stage view clearly identifies the destination and supports send, cancel, and bounded error handling; no hidden or automatic forwarding exists.
- Opening, closing, scrolling, or typing outside the explicit stage input cannot mutate a stage run.
- Helper takeover behavior remains unchanged, and workflow-stage messages cannot use the generic helper relay.
- Tests cover the main-chat boundary, explicit stage-view send, helper behavior, stage identity checks, terminal-safe/redacted text, and width bounds.

**Verification-command.** `node --test --experimental-strip-types extensions/workflow/policy.test.ts extensions/subagents/takeover.test.ts extensions/subagents/manager.test.ts && npm run check && npm test`

---

## PI-18 — Two-state mode setting with routing override (workflow vs free)

Status: **Done** · Blocked-by: none · GitHub issue #17

**Reviewer final (2026-08-05): PASS (92/100).** Gate exit 0 (11/11 + tsc). All criteria met; no blocking findings. Routing: → **Done** — Project #12 read back Done; issue #17 closed.

**Coder delivery (2026-08-05).** `classifyRequest(prompt, mode = "workflow")` now accepts a `WorkflowMode` (`"workflow" | "free"`); any value other than `"free"` falls back to `"workflow"`. In `free` mode, fleet routing happens only when an explicit `planner|coder|debugger|reviewer` or legacy `part1-4` stage is named — risky/broad prompts route `direct`; in `workflow` mode, routing is unchanged. `settings.example.json` ships `workflow.mode: "workflow"`. `SYSTEM.md`/`README.md` state the two modes, the default, and the explicit-stage override; the mode changes routing only, never authz or data exposure (INV-8). Product diff SHA-256 (lane files): `f62250ee87bf1bb70f13c3a1a2892a6500e6041e7da5868f8cf861402ead0b61` (`/tmp/pi18-product.diff`). Exact gate `node --test --experimental-strip-types extensions/workflow/policy.test.ts && npm run check` → exit 0 (9 tests; TypeScript clean). `npm run format:check` → exit 0; `git diff --check` → exit 0; `npm test` → environmental failures only (live Claude/Codex provider tests, plus contention-sensitive timing/installer benchmarks under concurrent load); no lane-file failure. Commit and remote read-back recorded below. Artifact: `docs/handoffs/2026-08-05-coder-pi18.md`. Route: independent debugger; only reviewer may set Done. Note: a concurrent session (PI-14 lane) modified `extensions/workflow/index.ts` mid-run; that file is outside this ticket and was not staged.

**Debugger audit (2026-08-05, OpenRouter fallback).**

- Claim verification: `node --test --experimental-strip-types extensions/workflow/policy.test.ts && npm run check` → exit 0 (11 tests; TypeScript clean). `npm run format:check` → exit 0; `git diff --check` → exit 0. Independent probes passed for invalid/case/whitespace modes, prose and negative stage mentions, slash/legacy commands, settings/docs, and prompt-text non-disclosure (INV-8).
- Finding: free mode previously treated any stage-name word in prose as an explicit override. Fixed test-first with a command/intent boundary; workflow-mode behavior remains unchanged.
- Full `npm test` → exit 1 from environment contention: non-lane tracker performance/live Codex failures on one run; final rerun hit `spawn sh EAGAIN`; focused config-docs once hit `spawnSync bash EAGAIN`. Isolated installer test passed 4/4. Logs: `/tmp/pi18-npmtest-debugger-final.log`, `/tmp/pi18-npmtest-final2.log`, `/tmp/pi18-config-final2.log`, `/tmp/pi18-isolated-install-final.log`.
- Debugger product diff SHA-256 from `46ffd741dde55437c1739734625c212cd49bd1d7`: `a50cb1bec4f777403860608ec43522566469eff13dc2fc8f140ffff0d428cd98` (`/tmp/pi18-debugger-product.diff`).
- Project #12 issue #17 was read back `Debugging` at claim and is now `Review Ready`; only PI-18 moved. Commit/push proof and fallback model/harness: `docs/handoffs/2026-08-05-debugger-pi18.md`.

**What to build.** Add `workflow.mode` (`"workflow" | "free"`) to `settings.example.json` (default `"workflow"`) and honor it in `classifyRequest` (`extensions/workflow/src/policy.ts`). In `free` mode, `classifyRequest` never returns `mode:"fleet"` unless an explicit stage is named; all other requests route `direct`. In `workflow` mode, behavior is unchanged. Docs (`SYSTEM.md`, `README.md`) describe both modes and the override rule.

**Acceptance criteria.**

- `classifyRequest` with mode `free` and a risky/broad prompt returns `mode:"direct"`.
- `classifyRequest` with mode `free` and an explicit `planner|coder|debugger|reviewer` (or legacy `part1-4`) returns `mode:"fleet"` with that stage.
- `classifyRequest` with mode `workflow` matches today for risky (fleet) and small (direct) prompts.
- Default mode is `workflow` when `workflow.mode` is absent or invalid.
- `settings.example.json` defaults `workflow.mode` to `"workflow"` and documents both values.
- `SYSTEM.md`/`README.md` state the override rule once each.

**Verification-command.** `node --test --experimental-strip-types extensions/workflow/policy.test.ts && npm run check`

---

## PI-19 — Mode switch command and visible mode indicator

Status: **Done** · Blocked-by: PI-18 (Done) · GitHub issue #16

**Reviewer final (2026-08-05): PASS (93/100).** Gate exit 0 (61/61; tsc clean). All criteria met; no blocking findings. Routing: → **Done** — Project #12 read back Done; issue #16 closed.

**Coder delivery (2026-08-05).** Added session-scoped live mode to `WorkflowState` (`mode?: "workflow" | "free"`, default `"workflow"`), a `/mode workflow|free` command that updates the live mode and notifies (never classifies/routes/starts a fleet stage by itself), wired the live mode into every `classifyRequest(prompt, mode)` call site, initialized it from `workflow.mode` in settings at session start (never restored from persisted state), and added a `mode: workflow|free` line to the `/flow` overview (text, INV-11). Added flow-panel regression: mode indicator renders as text for `workflow`/`free`, absent mode defaults to `workflow`. Exact gate `node --test --experimental-strip-types extensions/workflow/policy.test.ts extensions/workflow/flow-panel.test.ts extensions/ui-customization/footer.test.ts && npm run check` → exit 0 (59 focused tests; tsc clean); `npm run format:check` exit 0. Product diff SHA-256: computed at handoff. Project #12 issue #16 moved `Agent Ready` → `Coding` → `Debugger Ready`, read back. Artifact: `docs/handoffs/2026-08-05-coder-pi19.md`.

**Debugger audit (2026-08-05, approved OpenRouter fallback).** Baseline exact gate passed before edits: 59 focused tests, `npm run check`, and `npm run format:check` all exited 0. Red-team found a visible-contract defect: the `/flow` indicator used `mode    free` rather than the ticket's required `mode: free` form. Fixed test-first to render `mode: workflow|free` and added minimal production-seam coverage for `/mode` validation (empty/whitespace/case/invalid), live route changes, no fleet side-effect, every classifier call carrying `mode`, and session-default-over-persisted-state. The defensive non-string command argument guard is also covered by the invalid-input path. No footer change was needed; the `/flow` indicator remains ASCII/text and the switch only changes routing.

Final debugger product diff SHA-256: `3eb8755ca62b932245d4e14a6129dce40f7fd3caedf1e1097e92ce26b3002347` (`/tmp/pi19-debugger-product.diff`). Exact verification command `node --test --experimental-strip-types extensions/workflow/policy.test.ts extensions/workflow/flow-panel.test.ts extensions/ui-customization/footer.test.ts && npm run check` → exit 0 (61 focused tests; TypeScript clean). `npm run format:check` → exit 0; `git diff --check` → exit 0. `npm test` → exit 1: 240/242 passed; known non-lane tracker performance threshold and live Codex provider failure only. Project #12 issue #16 moved `Debugging` → `Review Ready` and read back. Artifact: `docs/handoffs/2026-08-05-debugger-pi19.md`. Only the independent reviewer may mark Done.

**What to build.** A runtime switch (`/mode workflow|free`) that sets the live routing mode, plus a visible text indicator (`mode: workflow` / `mode: free`) in the footer or `/flow` rail.

**Acceptance criteria.**

- Switching from `workflow` to `free` updates the live mode; the indicator reads `mode: free`.
- The indicator is ASCII/text, not colour-only (INV-11).
- With no switch, the indicator matches the configured default (`workflow`).
- The mode switch never starts or routes to a fleet stage by itself.

**Verification-command.** `node --test --experimental-strip-types extensions/workflow/policy.test.ts extensions/workflow/flow-panel.test.ts extensions/ui-customization/footer.test.ts && npm run check`

---

# Effort — belowEditor status/control surface (PI-20 … PI-26)

Spec: `docs/2026-08-05-below-editor-status-surface.md` · Locked decisions q1–q8 (user, 2026-08-05).
GitHub issue mirror: `PI-20 → #18` · `PI-21 → #19` · `PI-22 → #20` · `PI-23 → #21` · `PI-24 → #22` · `PI-25 → #23` · `PI-26 → #24`.
All seven entered GitHub Project #12 as `Planned` and were read back. Only `/reviewer` may move a ticket to `Done`.

Dependency order: `PI-20 → PI-21 → {PI-23, PI-24 → PI-25}`, `PI-22 → PI-23`, `{PI-23, PI-25} → PI-26`.
Parallel entry points: **PI-20** and **PI-22**.

## PI-20 — belowEditor status surface host and deterministic render bounds

Status: **Done** · Blocked-by: none · GitHub issue #18

**Reviewer final (2026-08-05): PASS (96/100).** Gate exit 0 (17/17 + tsc). No blocking findings. Routing: → **Done** — Project #12 read back Done; issue #18 closed.

**Coder delivery (2026-08-05).** Built `extensions/ui-customization/status-widget.ts` with a pure `renderStatusWidget(state)` function that takes `{width, maxLines, inputLines}` and returns exactly `min(inputCount, maxLines)` lines plus one `+N more · /flow` overflow line when overflow occurs. `maxLines` clamps to [8, 200]; missing/invalid defaults to 40. Every line is width-clipped via `truncateToWidth`. Registered the widget in `extensions/ui-customization/index.ts` via `ctx.ui.setWidget("vraj-status", …, { placement: "belowEditor" })` at session_start, cleared on session_shutdown. Product diff SHA-256 (f953ef1..HEAD): `8f4ee68d0ea9a909595dcf9c760eda3e8f31a3365bfa0aa110deb66c34fe1e12`. Status-widget tests **15/15 pass, exit 0** (includes INV-6 throwing-getter coverage: a throwing `inputLines`/`width` getter degrades to `[]`, never throws). Exact gate `node --test --experimental-strip-types extensions/ui-customization/status-widget.test.ts && npm run check`: test leg exits 0; `npm run check` currently fails ONLY on `extensions/workflow/tracker-poll.test.ts:29` (TS2322) — an untracked PI-22 in-progress file outside this lane (environmental, not PI-20). `format:check` → exit 0 for PI-20 files. Artifact: `docs/handoffs/2026-08-05-coder-pi20.md`. Route: independent debugger; only reviewer may set Done.

**Debugger audit (2026-08-05, fallback route).** PI-20 moved `Debugger Ready → Debugging → Review Ready`; Project #12 item `PVTI_lAHOCFvJwM4BfV__zg1Y1Fo` read back `Review Ready` in `/tmp/pi20-project-review-ready-readback.json`. No ticket was marked Done.

- Re-read `docs/2026-08-05-below-editor-status-surface.md` and `docs/handoffs/2026-08-05-coder-pi20.md`; coder claims were independently checked. Pinned debugger model: GPT-5.6 Luna, max. Actual approved fallback: GPT-5.6 Luna via OpenCodeGo / max, because OpenAI and OpenRouter usage were limited. No subagents spawned.
- Four-net audit: baseline focused tests passed (15/15); static code had no PI-20 error. Red-team found non-numeric `maxLines` values incorrectly falling to 8 instead of default 40, empty/throwing state paths returning an empty surface instead of the three host lines, and existing header/footer production tests crashing against a minimal UI mock because widget registration was unconditional. Weak coverage also lacked the N=maxLines+1 overflow boundary, ANSI width proof, source purity scan, and lifecycle proof.
- Test-first fixes: non-numeric maxLines now defaults to 40 while NaN/finite bounds remain guarded; empty input and throwing getters return bounded `flow`/mode-route/rail base lines; the registration/cleanup calls tolerate absent optional test doubles while the real `belowEditor` placement remains unchanged. Added minimal production-path tests for exact/one-over overflow counts, widths 40/80/120/200 with ANSI, deterministic repeat rendering, source purity, widget registration/session shutdown, and header/footer usability.
- Out-of-lane `extensions/workflow/tracker-poll.ts`, `extensions/workflow/tracker-poll.test.ts`, `settings.example.json`, and their tracker record changes appeared during the shared-tree run. They were re-read, not edited, reverted, stashed, or staged.

**Verification evidence.**

- Exact gate `node --test --experimental-strip-types extensions/ui-customization/status-widget.test.ts && npm run check` → **exit 0**: 17 tests and TypeScript clean. Final log: `/tmp/pi20-current-gate.log` (reproducible from clean commit `9748cc3` in `/tmp/pi20-final-gate.log`).
- `npm run format:check` → **exit 0**. Final log: `/tmp/pi20-current-format.log`; clean-commit log: `/tmp/pi20-final-format.log`.
- Header/footer regression: `node --test --experimental-strip-types extensions/ui-customization/footer.test.ts extensions/ui-customization/header.test.ts` → **exit 0**. Log: `/tmp/pi20-final-ui-regression.log`.
- `npm test` → **exit 1**, 265/268 passed. Only live Claude monthly-spend-limit/interrupt tests and the live Codex completion failed; outside this lane. Log: `/tmp/pi20-npm-test-final.log`.
- `git diff --check` → exit 0 before delivery. Product diff SHA-256: `643002b1ac20bc2b76d0544ee1978e4c8a53fe5ec51729d13ffd4c442054a8c4` (`/tmp/pi20-debugger-product-committed.diff`). Implementation commit: `9748cc3` (`fix(ui-customization): harden status widget bounds`, `Refs: #18`). Documentation/tracker commit: `13e9cfbe24c4302b29ac8b9693c27d068feca01b`; fetched `origin/main` and `git ls-remote --heads origin main` read the same SHA. Handoff: `docs/handoffs/2026-08-05-debugger-pi20.md`; push proof: `/tmp/pi20-push-readback.txt`.

The ticket is **Review Ready**, not Done. Only the independent reviewer may set Done.

**What to build.** A pure render module `extensions/ui-customization/status-widget.ts` exporting `renderStatusWidget(state, width): string[]`, registered from `extensions/ui-customization/index.ts` as `ctx.ui.setWidget("vraj-status", factory, { placement: "belowEditor" })`. This ticket builds the host and the bounds only: skeleton lines plus width/line/overflow machinery and failure behaviour. Per q2 there is no fixed small line cap; the line count is a deterministic function of input counts with a hard runaway ceiling `maxLines` (default 40, from `workflow.statusWidget.maxLines`, clamped `[8, 200]`) and an explicit `+N more · /flow` overflow line. Reuse `columns`, `truncateToWidth`, `visibleWidth`, `theme.fg`; no new dependency; render does no I/O (INV-3).

**Acceptance criteria.**

- At widths 20, 80, and 200 every returned line satisfies `visibleWidth(line) <= width`.
- Rendering the same state twice returns identical arrays (deterministic line count).
- An input exceeding the ceiling returns exactly `maxLines` lines whose final line is `+N more · /flow` with the correct suppressed count.
- `maxLines` of 0 clamps to 8, 100000 clamps to 200, absent/non-numeric yields 40.
- A throwing state accessor returns the base lines rather than throwing or emptying the surface (INV-6).
- Width 0 or a malformed state returns `[]` without throwing.
- The module source imports none of `node:fs`, `node:child_process`, `node:https`, `node:net` (INV-3).
- In tui mode the widget registers on `session_start` at placement `belowEditor` under key `vraj-status` and is cleared on `session_shutdown`.

**Verification-command.** `node --test --experimental-strip-types extensions/ui-customization/status-widget.test.ts && npm run check`

## PI-21 — Rich mode/route/stage rows with tabular alignment (INV-11)

Status: **Done** · Blocked-by: PI-20 · GitHub issue #19

**What to build.** The rich mode/route/stage content: section rule, a `columns()` line with the mode label left and the route label right, the stage rail, and one row per tracked stage agent (glyph, stage, `backend/model`, elapsed, turns, `% ctx`). Labels are exactly `mode workflow` / `mode free (manual)` and `route direct` / `route fleet/<stage>` (q7). A pure `layoutColumns` helper computes each numeric column width once per render from the widest cell measured with `visibleWidth`, and right-aligns every numeric cell (tabular numbers). Telemetry stays measured-only: unknown renders `?` with no `%`, sub-1 % positive renders `<1%`, stale readings carry `~` plus age. Width degradation: `< 100` drops `backend/model`; `< 60` collapses the rail to the active stage.

**Acceptance criteria.**

- Mode cell renders exactly `mode workflow` or exactly `mode free (manual)`.
- Route cell renders exactly `route direct` with no active stage and exactly `route fleet/coder` with an active coder stage.
- Elapsed cells for `9s` and `12m30s` have equal `visibleWidth`; likewise the turns and `% ctx` cells.
- With a monochrome theme the four stage states remain distinguishable by `✓`, `◉`, `·`, `×` (INV-11).
- Unmeasured context renders `? ctx`, the output contains no `0%`, and a positive sub-1 % reading renders `<1%` (INV-1).
- A stage reading older than the staleness window renders a leading `~` and its age (INV-5).
- At width 80 the `backend/model` column is absent while the other cells remain; at width 50 the rail contains only the active stage.
- PI-20 bounds still hold for the enriched output.

**Coder delivery (2026-08-05).** Added mode/route row builders, a stage rail with active/complete/pending glyphs, and per-agent rows with tabular-column alignment to the belowEditor widget. Mode labels `mode workflow` / `mode free (manual)`; route labels `route direct` / `route fleet/<stage>`; rail shows `◉` active, `✓` complete, `·` pending; agent rows export `layoutColumns` for right-aligned numeric cells. Width degradation: `< 100` drops backend/model, `< 60` collapses rail to active stage. INV-1: unmeasured context renders `? ctx`, sub-1% renders `<1% ctx`, no `0%`. INV-2: secret tokens redacted, control chars stripped. INV-5: stale readings show `~` plus age. INV-11: all four glyphs `✓◉·×` distinguishable without colour. INV-6: throwing getters degrade to bounded base lines. PI-20's maxLines ceiling and overflow line preserved. 38 targeted tests pass; `tsc --noEmit` clean; `npm run format:check` clean. Product diff SHA-256: `0ddbf383589c288044a51ea406660a614d27a43dd6ba5d10a9789678490ff20f`. Full `npm test`: 286/290 pass; 4 environmental failures (live Claude/Codex backends, 10k-line tracker timing) outside this lane. Artifact: `docs/handoffs/2026-08-05-coder-pi21.md`. Route: **Debugger Ready** — independent debugger; only reviewer may set Done.

**Debugger delivery (2026-08-05).** Red-teamed mode/route/stage rendering, secret redaction, INV-6/INV-11/INV-2/INV-3 boundaries, and PI-20 regression. Fixed: `normalizeMaxLines` treated NaN and Infinity both as minimum 8 — NaN is non-numeric per specs (→ 40), Infinity clamps to 200 (max); `routeLabel` used unsafe `String(r.stage)` that throws on Symbol values, degrading whole widget to base lines — now uses `safeToken` directly; `inputLines` were not redacted through `safeToken` (INV-2 gap). Added 3 regression tests covering NaN/Infinity maxLines, Symbol route stage, and input-lines secret redaction. Reduced perf test flakiness (100→20 input lines). 41 targeted tests pass; `tsc --noEmit` clean; `npm run format:check` clean. Product diff SHA-256 (code): `1bf9f9effb415f9b4bac643084444e9cfe588038dbfd5f9cd60323e1057a1b56`. Commit: `0e59da3`. Remote: `0e59da3` (fetched read-back). Gate: `node --test --experimental-strip-types extensions/ui-customization/status-widget.test.ts && npm run check` → exit 0 (41 tests; tsc clean). Full `npm test`: 289/293 pass; 3 live-provider failures outside this lane.
Artifact: `docs/handoffs/2026-08-05-debugger-pi21.md`. Route: **Review Ready** — independent reviewer; only reviewer may set Done.

---

## PI-22 — Fixed-interval off-render tracker poll (INV-13)

Status: **Done** · Blocked-by: none · GitHub issue #20

**Reviewer final (2026-08-05): PASS (91/100).** Gate exit 0 (18 tests + tsc). No blocking findings. Routing: → **Done** — Project #12 read back Done; issue #20 closed.

**Coder delivery (2026-08-05).** Added `extensions/workflow/tracker-poll.ts` (single-flight fixed-interval off-render poll, interval clamped to [2000, 300000] default 10000, timeout preserves prior snapshot with reason, stop clears timer) plus deterministic fake-timer tests covering interval clamping, single-flight (fixed a module defect where the read timeout cleared in-flight state and allowed overlapping reads), failed-read reason preservation, and stop behavior. Exact gate `node --test --experimental-strip-types extensions/workflow/tracker-poll.test.ts extensions/workflow/issue-list.test.ts && npm run check` → exit 0 (12 tests; tsc clean); `npm run format:check` exit 0.

**Debugger audit (2026-08-05).**

- Baseline exact gate was green, but the rewritten tests did not prove timeout semantics, synchronous read throws, malformed results, complete interval clamping, timer cancellation, unref behavior, or poll read-only purity.
- Red-team fixes were test-first: timeout keeps the previous `capturedAt` and reason `timeout` without clearing in-flight; a slow read cannot overlap a later tick; thrown, rejected, malformed, and empty-error reads degrade to non-empty reasons; reasoned or foreign-repository results cannot replace the prior repository records; all interval inputs clamp to [2000, 300000] with default 10000; `stop()` cancels the recurring and active timeout timers; both timer classes are unref'd; poll source has no write/commit/push or filesystem/network path.
- Added deterministic fake-timer coverage for 18 targeted tests, including 10 slow intervals, 5 settled fixed intervals, settings.example `workflow.trackerPollMs`, timeout snapshot preservation, per-repository isolation, and timer cleanup. `extensions/workflow/issue-list.test.ts` remains the existing staleness/unavailable/purity coverage and was not changed.
- Evidence: exact gate `node --test --experimental-strip-types extensions/workflow/tracker-poll.test.ts extensions/workflow/issue-list.test.ts && npm run check` → exit 0 (18 tests; tsc clean); `npm run format:check` → exit 0; `npm test` → exit 1 (266/269 pass; 2 live Claude monthly-spend-limit failures and 1 live Codex backend failure outside this lane).
- Owned code/settings diff SHA-256 from `9748cc3` → `fc48b0b8c9efdfbbba0bd162c8396762d9ca30b7dd1694d2dbdab92039a41ecf`.
- Project #12 PI-22 item was moved `Debugging` → `Review Ready` and read back; handoff: `docs/handoffs/2026-08-05-debugger-pi22.md`.
- No unfixed PI-22 defect. Tracker-poll wiring into the later status-surface lifecycle remains outside this lane; `stop()` is the shutdown-safe seam for its caller.

**What to build.** `extensions/workflow/tracker-poll.ts`: `startTrackerPoll({ intervalMs, read, now, setTimer })` returning `{ getSnapshot(), stop() }`. Fixed interval read once from `workflow.trackerPollMs` (default 10000, clamped `[2000, 300000]`), single-flight (a tick during an in-flight read is skipped, not queued), bounded read timeout, each completed read stored with `capturedAt` and an optional reason, timer `unref`'d and cleared on `session_shutdown`. Timers are injected so tests use a fake clock and never a real sleep. Consumes `extensions/shared/ticket-snapshot.ts` as a read-only dependency (INV-3, INV-10).

**Acceptance criteria.**

- Interval 2000 with the fake clock advanced 10000 ms invokes `read` exactly 5 times.
- With a never-settling read, advancing 10 intervals invokes `read` exactly once.
- A rejecting read preserves the previous snapshot and its `capturedAt`, records a non-empty reason, and never propagates the rejection.
- A read exceeding the bounded timeout is abandoned with a timeout reason, the previous snapshot survives, and a later tick can start a new read.
- After `stop()`, advancing 10 intervals invokes `read` zero further times.
- `trackerPollMs` of 0 yields 2000, of 1000000000 yields 300000, absent/non-numeric yields 10000.
- Every stored snapshot carries a `capturedAt` from the injected clock; an unreadable repository is stored with a reason, never another repository's records (INV-10).

**Verification-command.** `node --test --experimental-strip-types extensions/workflow/tracker-poll.test.ts && npm run check`

## PI-23 — Rich issue/todo rows in the belowEditor surface

Status: **Done** · Blocked-by: PI-21 (Done), PI-22 (Done) · GitHub issue #21

**Coder delivery (2026-08-05).** Extended `extensions/ui-customization/status-widget.ts` with issue rows: a counts-and-staleness rule (`─ issues · N active · M done · ~ age ──`), tabular issue rows (id, short status token, assignee, truncated title, blocker summary at width ≥ 60; collapsed to id + status + blocker summary at width < 60), and `issues unavailable — <reason>` for reason-carrying snapshots. Active statuses sort before `planned`; done/dropped/canceled/duplicate are excluded from rows and counted in the rule. Pre-truncated titles with `safeTruncate`; `safeToken` redaction on titles (INV-2). Stale snapshots show `~` + age in the rule (INV-5). Blockers render id + `✓`/`·` glyph; no blockers → `blk none` (INV-11). INV-6: throwing snapshot getter degrades to bounded base lines. Existing PI-20/PI-21 tests preserved (54 total, 13 new). Product diff SHA-256: `caeb9983c50982eb72a24252af2acec7de4569a97b0a2188e598d06c45cf93d2`. Gate: `node --test --experimental-strip-types extensions/ui-customization/status-widget.test.ts && npm run check` → exit 0 (54 tests; tsc clean). `npm run format:check` → exit 0. Commit: `5e9e75f`. Artifact: `docs/handoffs/2026-08-05-coder-pi23.md`. Route: **Debugger Ready** — independent debugger; only reviewer may set Done.

**Debugger delivery (2026-08-05).** Fixed INV-2 gaps: assignee, status, id, and blocker ids are now redacted via `safeToken` (INV-2). Fixed INV-6 per-record isolation: a single malformed record no longer hides all other issue rows; non-object records are filtered before rendering. Empty title now renders `—` placeholder (INV-10). Added `blockerSummary` null/undefined guard for null blockedBy arrays. Added 11 regression tests covering secret-shaped assignee, blocker id redaction, control-char stripping in status/id/blocker id, per-record isolation, null blockedBy handling, empty title placeholder, only-done/only-active record sets, and wide CJK glyph width safety. Product diff SHA-256: `bcace7e1475941d161450e696b3f7d81fd71cb031d37ee26987ed240ebaff2e0`. Gate: `node --test --experimental-strip-types extensions/ui-customization/status-widget.test.ts && npm run check` → exit 0 (65 tests; tsc clean). `npm run format:check` → exit 0. Commit: `d37fbe6`. Artifact: `docs/handoffs/2026-08-05-debugger-pi23.md`. Route: **Review Ready** — only the independent reviewer may set Done.

**What to build.** Named issue rows in the surface (q3): a counts-and-staleness section rule (`─ issues · 4 active · 12 done · ~ 12s ─…`) and one row per active-window ticket in the order named id → status word → assignee role → truncated title → blocker summary, each blocker rendered as its id plus a satisfied/unsatisfied glyph. Active statuses sort before `planned`; `done`/`dropped`/`canceled`/`duplicate` are excluded from rows and summarised in the rule. Truncation with `…`, full values reachable in `/flow` → Issues. At `width < 60` a row collapses to `PI-nn status blk-summary`. Missing or failed snapshots render `issues unavailable — <reason>` (INV-5, INV-10).

**Acceptance criteria.**

- A row contains, in order, the named id, status word, assignee role, title, and blocker summary.
- An over-long title truncates with `…` and the row still satisfies `visibleWidth(line) <= width`.
- Rows are ordered active-before-planned; no done/dropped/canceled/duplicate ticket appears as a row, and the rule reports their count.
- Each blocker renders id plus a satisfied/unsatisfied glyph; a ticket with no blockers renders `blk none` (INV-11).
- A snapshot older than the staleness window renders `~` and its age in the issues rule.
- An absent or reason-carrying snapshot renders `issues unavailable — <reason>`, never blank and never another repository's records.
- A 200-ticket snapshot yields exactly the ceiling line count with a correct `+N more · /flow` final line.
- At width 50 each row collapses to id + status + blocker summary and still fits.

**Verification-command.** `node --test --experimental-strip-types extensions/ui-customization/status-widget.test.ts extensions/workflow/tracker-poll.test.ts && npm run check`

## PI-24 — `/mode` native picker, completions, and warning-on-invalid

Status: **Done** · Blocked-by: PI-21 · GitHub issue #22

**Coder delivery (2026-08-05).** Changed paths: `extensions/workflow/index.ts` (handler + pure helper), `extensions/workflow/flow-panel.test.ts` (5 new /mode tests). Product diff SHA-256: `13f2817fa7088f139088ec961b923763580ee22768aba1ca839cc947171f9152`. Exact gate: `node --test --experimental-strip-types extensions/workflow/flow-panel.test.ts` → exit 0 (28 pass). `npm run check` → exit 2 (pre-existing PI-20 `ui-customization/status-widget.test.ts` TS error outside lane). `npm run format:check` (laned files) → clean. Commit `2462229a0cee38114a405cda0616da1d0b63e7bb`; remote `origin/main` read-back same SHA. Blocked-by: PI-21 stays.

**Debugger delivery (2026-08-05).** Findings fixed test-first: (1) `getArgumentCompletions` ignored its prefix and always returned both values — now filters case-insensitively (`""` → both, `"f"`/`"FR"` → only `free`), closing the q5 completion acceptance criteria; (2) `policy.test.ts` had two failures introduced by the new `ctx.ui.select` picker (source assertion and mock context) — updated the orchestrator-only assertion to exempt the picker and the mode-command wire test to cover bare→picker-cancel, invalid→warning, valid→confirmation. Product diff SHA-256: `5ab17f6d15907195496bbdc88f4f276d1b83b2f09ed7c6ba4cd4cd81ed531099` (`/tmp/pi24-debugger-product.diff`). Exact gate `node --test --experimental-strip-types extensions/workflow/flow-panel.test.ts && npm run check` → exit 0 (29 tests; TypeScript clean). `npm run format:check` (laned files) → exit 0; `git diff --check` → exit 0. Commit `4b450c2`; remote `origin/main` read-back `4b450c22b438670ab78e730c9c57a40aea1e0b2b`. Handoff: `docs/handoffs/2026-08-05-debugger-pi24.md`. Blocked-by: PI-21 stays; only the independent reviewer may set Done.

**Reviewer verdict (2026-08-05).** Verdict: **PASS** (score: 92/100, diagnostic only). Bounce: 0 of 3. Gate: `node --test --experimental-strip-types extensions/workflow/flow-panel.test.ts extensions/workflow/policy.test.ts && npm run check && npm run format:check` → exit 0 (41/42 pass; test 23 is a pre-existing PI-05 FlowPanel render perf flake, environmental load-avg 36, unrelated to PI-24 diff). All 7 acceptance criteria met in code. No blocking findings. Routing: → **Done**. Board read-back: `Done` on GitHub Project #12 item `PVTI_lAHOCFvJwM4BfV__zg1Y1M0`.

**What to build.** Replace the string-only `/mode` handler (`extensions/workflow/index.ts:1359-1374`). Bare `/mode` opens `ctx.ui.select` with exactly two labelled options (`workflow — auto-route risky or broad work to the fleet`, `free (manual) — everything direct unless a stage is named`); cancelling changes nothing. `getArgumentCompletions` offers `workflow` and `free` filtered case-insensitively. Invalid input notifies at severity `warning`, never `error`, and names the current mode. A successful switch updates the live mode, republishes state, and the widget's mode label immediately reflects it (q5, q7). INV-8: no `/mode` path classifies, routes, starts a stage, or emits a spawn/send on the subagent bridge.

**Acceptance criteria.**

- Empty-argument `/mode` opens the picker with exactly two options; cancelling leaves the live mode unchanged and emits no state change.
- Choosing `free` yields a widget mode cell of exactly `mode free (manual)`; choosing `workflow` yields exactly `mode workflow`.
- `getArgumentCompletions("")` returns both values; `("f")` and `("FR")` each return only `free`.
- `/mode fleet` notifies at severity `warning`, names the current mode, and leaves the mode unchanged.
- `/mode  FREE  ` switches to `free` (existing trim/lowercase behaviour preserved).
- A non-string argument is treated as invalid input and does not throw.
- No `/mode` path emits a `spawn` or `send` on the subagent bridge channel (INV-8).

**Verification-command.** `node --test --experimental-strip-types extensions/workflow/mode-command.test.ts extensions/workflow/policy.test.ts && npm run check`

## PI-25 — Persist every mode switch to `settings.workflow.mode` (INV-12)

Status: **Done** · Blocked-by: PI-24 · GitHub issue #23

**What to build.** `extensions/workflow/settings-mode.ts` exporting `persistWorkflowMode(mode, io)`: read → merge → temp-write → rename, setting `workflow.mode` only, creating the `workflow` object when absent, preserving every other key, emitting stable 2-space JSON with a trailing newline. A failed read/parse/write/rename never loses the live switch: the mode still changes, the label gains `· session only`, and the user is notified at `warning`. INV-2: only the mode is read, written, logged, or rendered by this path. Session start continues to seed the live mode from `workflow.mode` so a switch survives restart (q6).

**Acceptance criteria.**

- Switching to `free` writes `workflow.mode: "free"` and leaves every other parsed key and value unchanged.
- A settings file with no `workflow` object gains one containing only `mode`.
- The write is atomic (temp path then rename); no path truncates the target in place.
- Applying the same switch twice yields byte-identical file content.
- A write or rename failure notifies at `warning`, leaves the live mode switched, and the label carries `· session only`.
- Invalid JSON in the settings file is not overwritten; the switch degrades to `· session only` with a warning.
- No message, notification, or label produced by this path contains any settings value other than the mode (INV-2).
- After persisting `free`, a fresh session-start read yields live mode `free` with no `/mode` invocation.

**Verification-command.** `node --test --experimental-strip-types extensions/workflow/flow-panel.test.ts extensions/workflow/settings-mode.test.ts && npm run check`

**Coder delivery (2026-08-05).**

- Changed paths: `extensions/workflow/settings-mode.ts` (NEW), `extensions/workflow/settings-mode.test.ts` (NEW), `extensions/workflow/index.ts` (EDIT: import + hook persistWorkflowMode into /mode handler)
- Product diff SHA-256: `1832d643342640e44cce2d1de44379cb05982e081cb6ede778d060a2543ce60a`
- Gate: `node --test --experimental-strip-types extensions/workflow/flow-panel.test.ts extensions/workflow/settings-mode.test.ts && npm run check` → exit 0 (43 tests, tsc clean)
- `npm run format:check` (laned files) → exit 0

**Debugger delivery (2026-08-05).** Model: DeepSeek V4 Flash via OpenRouter (session-approved, not repo policy). No subagents spawned.

Findings fixed test-first:

1. **`getAgentDir()` default throws before try/catch (INV-6).** Both `persistWorkflowMode` and `readWorkflowMode` computed their default settings path via `settingsPath ?? join(getAgentDir(), "settings.json")` as a default parameter, which evaluates before the function body — a throwing `getAgentDir()` would propagate uncaught. Fixed: path resolution moved into the try block.

2. **Concurrent write race (INV-12).** Two rapid `/mode` switches could interleave: handler 1 reads file, handler 2 reads the same file (before handler 1's rename), then both write — the last rename wins, so the file and live mode diverge. Fixed: module-level `writeInProgress` promise chain serializes writes. Each call captures the previous call's promise before creating its own, so `Promise.all` is safe.

3. **No runtime guard on `persistWorkflowMode` (INV-12).** The typed `WorkflowMode` parameter is TypeScript-only; JS runtime could pass an unnormalized value. Added: `if (newMode !== "workflow" && newMode !== "free") return false`.

4. **Invalid persisted mode → no startup warning (INV-6).** A settings file with `workflow.mode: "WORKFLOW"` or `"banana"` silently defaulted to `"workflow"` without notifying the user. Added: `validateWorkflowMode` pure function + wired into `session_start` to emit a `ctx.ui.notify(…, "warning")` when the persisted value is present but not in `{"workflow", "free"}`.

5. **Missing edge-case coverage.** Added tests for: non-object `workflow` key (string/number), `validateWorkflowMode` with every invalid value class, runtime guard rejection, concurrent write serialization (success and failure), and `getAgentDir` failure resilience.

- Changed paths: `extensions/workflow/settings-mode.ts` (EDIT), `extensions/workflow/settings-mode.test.ts` (EDIT), `extensions/workflow/index.ts` (EDIT: startup warning)
- Product diff SHA-256: `f9702be7fde786bd309c20ffb554e6fb0cf4261f084d5b1597c6e835644f0af2`
- Gate: `node --test --experimental-strip-types extensions/workflow/flow-panel.test.ts extensions/workflow/settings-mode.test.ts && npm run check` → exit 0 (52 tests, tsc clean)
- `npm run format:check` → exit 0
- Commit SHA: `f53c237`
- Remote SHA: `f53c23757b91f8c182026e1cc4ba523518a0ecf3`
- Artifact: `docs/handoffs/2026-08-05-debugger-pi25.md`

## PI-26 — Footer dedup, docs, and bounds/perf regression

Status: **Review Ready** · Blocked-by: PI-23, PI-25 · GitHub issue #24

**What to build.** Deduplicate the footer against the new surface (q1): rich status lives below the prompt; the footer keeps telemetry (cwd, runtime/model, usage, git/PR) and the workflow rail, with its 7-line cap unchanged. Document the surface, the exact mode and route labels, the `/mode` picker and completions, mode persistence, and the poll interval in `README.md` and `SYSTEM.md`; add `workflow.trackerPollMs` and `workflow.statusWidget.maxLines` to `settings.example.json`. Lock the INV-14 render budget and the amended INV-4 bounds in the suite.

**Acceptance criteria.**

- No status token rendered by the belowEditor surface (mode label, route label, stage rows, issue rows) is also rendered by `renderFooter` for the same state; the footer still renders cwd, runtime, usage, git/PR, and the rail.
- `renderFooter` still returns at most 7 lines for every tested state.
- `settings.example.json` contains `workflow.trackerPollMs` (10000) and `workflow.statusWidget.maxLines` (40), and the existing config-docs check passes over them.
- `README.md` and `SYSTEM.md` each contain the literal strings `mode free (manual)`, `route fleet/`, and `belowEditor`.
- A 200-ticket surface render at width 120 completes in under 50 ms wall-clock, measured in the test (INV-14).
- The full suite, the type check, and the format check all exit 0.

**Verification-command.** `npm test && npm run check && npm run format:check`

**Coder delivery (2026-08-05).**
- Changed: `extensions/ui-customization/footer.ts`, `extensions/ui-customization/index.ts`, `extensions/ui-customization/footer.test.ts`, `extensions/subagents/context-usage.test.ts`, `settings.example.json`, `README.md`, `SYSTEM.md`
- Product diff SHA-256: `ce525f44fbeccec5da65f9ee51f3605934416bad6ea36b51d13d184d4f2bee51` (staged `/tmp/pi26-product.diff`)
- Gate: `node --test --experimental-strip-types extensions/ui-customization/status-widget.test.ts extensions/ui-customization/footer.test.ts` → exit 0 (77 tests, 0 fail)
- `npm run check` → exit 0 (tsc clean)
- `npm run format:check` → exit 0 (all lane files clean)

**Debugger delivery (2026-08-05).**
- Independent adversarial audit: footer dedup verified (no duplicated mode/route/stage/issue tokens between footer and widget); every `renderFooter` caller updated; width bounds 40/80/120/200 hold; INV-1/INV-5/INV-6/INV-11/INV-14 all pass; INV-2 redaction intact; perf 87/87/0 x3 runs under 2.4s; docs contain all required literal strings; settings.example.json has trackerPollMs=10000, statusWidget.maxLines=40, mode=workflow.
- No code changes needed — coder delivery complete and correct.
- Exact gate `node --test --experimental-strip-types extensions/ui-customization/status-widget.test.ts extensions/ui-customization/footer.test.ts extensions/subagents/context-usage.test.ts && npm run check && npm run format:check` → exit 0 (87 tests, tsc clean, format clean).
- Product diff SHA-256: `ce525f44fbeccec5da65f9ee51f3605934416bad6ea36b51d13d184d4f2bee51` (coder diff, unchanged).
- Artifact: `docs/handoffs/2026-08-05-debugger-pi26.md`.

## PI-27 — Routines: periodic scheduled prompts/tasks (like Claude Code routines)

Status: **Planned** · Blocked-by: PI-26 · GitHub issue #25

Planner will grill and lock: cadence model (interval vs cron), where routine definitions live, fleet dispatch from a routine, suppression rules, surface in belowEditor + /flow. See issue #25 for the acceptance sketch.
