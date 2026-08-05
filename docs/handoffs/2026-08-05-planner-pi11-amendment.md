# Planner handoff — PI-11 scope amendment → next harness

## State

- Ticket: PI-11 / GitHub issue #1 / Project #12 item `PVTI_lAHOCFvJwM4BfV__zg1N9ZY`.
- Tracker status: `Agent Ready`, read back after the human decision.
- Human decision: **Amend invariant**. Do not fix the unconsumed shared formatter in PI-11.
- PI-06/#2, PI-07/#9, PI-08/#10, PI-09/#11, and PI-15/#12 are `Done`.
- PI-16/#3, PI-13/#4, PI-17/#5, PI-12/#6, PI-10/#7, and PI-14/#8 remain `Planned` behind the PI-11 dependency chain.
- No active agents. PI-11 is not Done.

## Amended invariant

For PI-11 only, positive sub-1% usage may round to `0%` in the unconsumed shared helper `extensions/shared/context-utilization.ts`; this is an accepted display-precision residual, not task progress. Zero, negative, non-finite, malformed, and missing readings remain unknown with no percent. Shipped stage-row paths retain `<1%` behavior. Orchestrator-only input, no-`STEER`, relay identity, read-only takeover, secret redaction, width/line bounds, and no-new-trust-edge requirements remain hard. The shared-helper residual remains separate follow-up work.

## Durable changes

- Issue #1 body updated with the amended scope, acceptance criteria, Project #12 authority, and exact verification command: https://github.com/VrajGupta/Pi-Setup/issues/1
- `docs/2026-08-04-flow-todo-crossrepo-and-docs.md` records the decision and non-goals.
- `tickets.md` moves PI-11 from `Reviewing` to `Agent Ready` and preserves bounce-3 history.
- Amendment commit: `ff96fe0d92615a4604412a31a327ef5f4476b26e`.
- Remote `main` read-back: `ff96fe0d92615a4604412a31a327ef5f4476b26e`.
- Takeover context commit: `38a97d5ad64363bf9c290f9898ccb04cd1d23fcf`; remote `main` read-back: `38a97d5ad64363bf9c290f9898ccb04cd1d23fcf`.

## Verification and recovery

- Docs-only validation: `npm run check`, `npm run format:check`, and `git diff --check` passed before the amendment commit.
- PI-11's exact production gate remains in issue #1 and `tickets.md`; next coder must re-read the amended issue and decide whether current code needs no implementation change or a minimal scope-consistent repair.
- Required chain: coder → debugger (Luna max) → independent reviewer. Only reviewer may set PI-11 `Done`.
- Do not touch `extensions/shared/context-utilization.ts` under this amended ticket. Do not promote dependent Phase 3 tickets until PI-11 is independently reviewed and Done.
- After PI-11 Done, promote and drain PI-16/PI-13/PI-17, then PI-12, PI-10, and PI-14 in blocker order.
- No credentials, tokens, cookies, raw transcripts, or private session data are included.
