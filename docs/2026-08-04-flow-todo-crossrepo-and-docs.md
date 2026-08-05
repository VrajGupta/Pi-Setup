# Plan addendum — issues view, footer consolidation, cross-repo status, docs

Date: 2026-08-04 · Stage: planner (plan) · Repo: `~/Work/pi-agent`
Extends `docs/2026-08-04-flow-ui-and-token-savings.md`. Nothing in that document is revoked.

## State of the world (evidence, gathered before planning)

| Claim | Evidence |
| --- | --- |
| PI-05 is Done at `9b3b7f3` | `git log --oneline` → `9b3b7f3 review: mark PI-05 done after recovery` |
| HEAD and remote both at `bb5d79e`; nothing to rewrite | `git log --oneline -1` → `bb5d79e`; `git ls-remote origin HEAD` → `bb5d79e723ed0755f69213c61a05fec1257cb441` |
| A remote now exists (push proof is possible and already demonstrated) | `git remote -v` → `origin https://github.com/VrajGupta/Pi-Setup.git`; remote HEAD equals local HEAD |
| Working tree clean at plan start | `git status --short` → empty |
| `bb5d79e` is a real code change that never passed the pipeline | Diff touches `extensions/workflow/index.ts` (removes the `input` steering hook), `src/policy.ts` (removes `canSteerStage`), `footer.ts` + `flow-panel` (`<1% ctx` label), `claude.ts` (zero-usage → unknown), plus 4 test files, `README.md`, `SYSTEM.md`, and a tracker "Immediate priority override" block. No ticket, no debugger audit, no reviewer verdict records it. |
| Baseline gate green now that quota is restored | `npm run check` → exit 0 (tsc clean); `npm test` → exit 0, 167 Node tests pass + 22 Vitest tests pass. The live Claude backend tests that failed during PI-05 review now pass. |
| Workflow status is still duplicated in the header | `extensions/ui-customization/index.ts:151-186` — `setHeader` renders `FLOW/STEER route · status · stage` and `AGENTS N running · N tracked` on two header lines, while `setFooter` renders the same route/status rail |
| PI-10 as written lacks repository, assignee, and ETA | `tickets.md` PI-10 acceptance criteria cover ID, title, status, `Blocked-by` only |
| No cross-repository view exists | `grep -rn "repo" extensions/workflow` finds no repository concept; the tracker source is the single local `tickets.md` |
| Setup docs have no rollback or Windows section | `SETUP.md` is 36 lines; `grep -i "rollback\|uninstall\|windows" SETUP.md README.md` → no hits, though `README.md` says the installer "backs up current runtime resources" |

## Handling of the stale continuation `bb5d79e`

Preserved, not rewritten. It is the parent of all new work. Its content is real and its tests are green, but it never had an invariant audit or an independent review, and the tracker records its intent only as an unticketed "Immediate priority override" block. **PI-11 retro-gates it forward-only**: it adds the missing ticket, the missing coverage, and a normal debugger→reviewer pass on top of `bb5d79e`. No `reset`, no `rebase`, no force-push, no revert of that commit is authorized by this plan.

## Defaults recorded (reversible, not user decisions I invented authority over)

1. **Repository registry is explicit, never a filesystem scan.** Cross-repo status reads a declared list of repo roots from settings (`workflow.repositories`), defaulting to `[<this repo>]`. No walking of `~/Work`, no auto-discovery. If the user wants discovery, that is a new decision.
2. **Assignee means pipeline role owner, not a GitHub login.** The assignee shown is the stage that currently owns the ticket (`planner|coder|debugger|reviewer`), derived from status, plus an optional explicit `Assignee:` field in the ticket when present. Visible roles stay planner/coder/debugger/reviewer.
3. **Cross-repo access is read-only.** Nothing in this plan writes to, commits in, or pushes from any repository other than `~/Work/pi-agent`.

## New invariants (testable; `/debugger` attacks these, `/reviewer` reviews them)

- **INV-9 honest ETA.** An ETA is rendered only when it is computed from measured, completed same-tracker stage durations for at least 3 comparable finished tickets, and it is rendered as a range with its sample size (`eta 20–60m (n=4)`). With fewer samples the field reads exactly `eta unknown`. An ETA never derives from a percentage, a token count, or a guess, is never presented as a deadline, and an ETA whose inputs are older than the staleness window carries the `~` prefix like every other reading. Extends INV-1.
- **INV-10 cross-repo reads are off the render path and fail visibly.** Every repository read (tracker file, git state) happens outside render, is cached with a capture timestamp, and is bounded. A repository that is unreadable, missing, or slow renders `unavailable` with a reason — never another repository's data, never blank, never stale-as-current. Extends INV-3/INV-5/INV-6.
- **INV-11 meaning never depends on colour alone.** Every status, staleness, and blocked distinction is carried by text or an ASCII glyph that survives `NO_COLOR`/monochrome rendering; colour is decoration only. Applies to footer, `/flow`, and every new view.

Existing INV-1 … INV-8 continue to apply unchanged, in particular INV-2 (no secret), INV-4 (≤7 footer lines, width bounds), and INV-8 (no new trust edge without a decision).

## Dependency order

```
bb5d79e (preserved)
  └─ PI-11  retro-gate the continuation commit
       ├─ PI-12  header status → footer consolidation
       └─ PI-13  tracker source + honest ETA (pure module)
            └─ PI-10  /flow Issues/Todos view      (also needs PI-12)
                 └─ PI-14  repository registry + cross-repo status view
  PI-06 → PI-07 → PI-08 → PI-15   (Phase 2; PI-09 may run in parallel after PI-06)
```

Phase 2 (PI-06 … PI-09, PI-15) is unblocked today and may proceed in parallel with the Phase 3 UI chain; the two chains touch disjoint files except `SYSTEM.md`/`README.md`, which PI-06 and PI-15 must not edit in the same wave.

## Scope boundaries

- PI-09 stays document-only: no credentials, no real prompts, no routing change (INV-8). Its verdict line is the gate.
- Push proof already exists (remote HEAD == local HEAD at `bb5d79e`); PI-15 documents *how* to reproduce it and how to roll the install back, and does not claim any new push.
- No ticket here is marked Done by planning. Every new ticket enters as `Planned`, and only `/reviewer` may move a ticket to `Done`.

## User escalation mid-plan (2026-08-04) and what it changed

1. **"I will only talk to the orchestrator."** Restated as a hard rule, not a preference. Evidence that the guarantee is still incomplete: `settings.example.json` ships `"steeringMode": "all"` and the installed `~/.pi/agent/settings.json` line 10 has the same value; `extensions/ui-customization/index.ts:169` still renders a `STEER` label whenever a stage is active. The extension-level `input` hook was already removed by `bb5d79e`, but that commit was never gated. → **PI-11**, raised to priority 1.
2. **"After 15m there is 1t 0% beside the planner."** The number is context-window occupancy, not task completion, and a row that can only report elapsed time must instead report *why* it is silent. → **PI-16**, priority 2, plus the zero-usage and `<1% ctx` regressions folded into PI-11.
3. **"Nothing is in the Pi repo, put it all up now."** Measured, not assumed: `git branch -vv` → `main bb5d79e [origin/main]`; `git ls-remote origin` → `refs/heads/main = bb5d79e723ed…`; `git log origin/main..HEAD` → empty. Every committed file in this repo is already on `https://github.com/VrajGupta/Pi-Setup`. What is *not* pushed is this plan itself (`tickets.md` edits + this document), which the planner stage is not authorized to commit. If the repo looks empty to the user, the likely causes to check are the GitHub default-branch setting on `Pi-Setup` and whether `~/.pi/agent` is still linked to this checkout — neither is a missing push. PI-15 turns the push-proof commands into documentation so this question is answerable without a planner run.

## Amendment (human decision, 2026-08-05) — PI-11 display-precision residual

`/reviewer` failed PI-11 three times and escalated to the human. The third and final
blocking finding was **not** a safety, input-routing, or fabrication defect: it was a
rounding residual in the shared helper `extensions/shared/context-utilization.ts`,
where `formatContextUtilization({ tokens: 1, contextWindow: 200_000 })` returns
`0%/200k` instead of `<1%/200k`. The human decision is to **amend PI-11's scope**,
not to fix that helper inside PI-11.

**What is accepted, precisely.** For PI-11 only, a *positive* sub-1 % context reading
may round to `0%` in the shared formatter `extensions/shared/context-utilization.ts`.
This is recorded as an accepted **display-precision residual**, and it is explicitly
**not** a statement that the honest-telemetry work is complete.

**What is NOT relaxed** — every one of these remains a hard, blocking requirement of
PI-11 and of the invariant set:

- **Orchestrator-only input stays hard.** No keystroke, setting, extension hook, or
  UI affordance may deliver Vraj's interactive input to a stage agent; the only route
  to a stage is an explicit `workflow send` relay made by the orchestrator.
- **Settings / no-`STEER` stays hard.** `settings.example.json` and the installed-settings
  merge keep input with the orchestrator and migrate the legacy value idempotently; no
  surface renders `STEER` or any equivalent steering affordance.
- **Zero and invalid telemetry stay unknown.** Zero, negative, non-finite, malformed, and
  missing token or capacity readings remain *indeterminate*: they render no `%` at all
  (`?/capacity`, or omitted when capacity itself is invalid). Fabricating a measured
  `0%` from an unknown reading remains forbidden — INV-1 and INV-6 are unchanged.
- **Capacity and unknown semantics are retained.** `?/capacity` still preserves the useful
  capacity; an invalid capacity still omits the statistic rather than inventing one.
- **The shipped stage-row path still renders `<1%`.** `extensions/subagents/src/format.ts`
  (the copy consumed by the subagent dashboard, the stage takeover header, the footer, and
  `/flow`) renders tiny positive occupancy as `<1%`, never `0%`. Measured 2026-08-05:
  subagent formatter → `<1%/200k`, `7%/372k`, `?/200k`; shared helper → `0%/200k`,
  `7%/372k`, `?/200k`. As of that date no non-test module imports
  `extensions/shared/context-utilization.ts`, so the residual is confined to that
  unconsumed shared copy.
- **All other safety gates stay hard.** Stage takeover remains read-only (no send, no
  abort), relay sends require the active stage ID, INV-2 secret redaction, INV-4 width and
  line bounds, INV-8 no-new-trust-edge, and INV-11 no-meaning-by-colour-alone are untouched.

**Scope of the amendment.** It applies to PI-11 alone. It does not amend INV-1 or INV-6 for
the project, does not license a `0%` reading anywhere on a shipped render path, and does not
pre-approve the residual for PI-16 or any other ticket. Closing the residual in
`extensions/shared/context-utilization.ts` (or deleting that unconsumed copy) remains open
work to be ticketed separately; PI-11 being accepted does **not** mean that task is complete.

**Process.** PI-11 returns to `Agent Ready` with amended acceptance criteria so the pipeline
re-runs it against the amended text and an independent reviewer issues a fresh verdict. The
prior reviewer blocker is resolved *by recorded scope amendment*, not by erasure: the bounce
history in `tickets.md` and `docs/handoffs/2026-08-04-reviewer-pi11-bounce-3.md` stay as
written. Only `/reviewer` may move PI-11 to `Done`.
