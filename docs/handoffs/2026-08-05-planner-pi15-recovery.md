# Planner handoff — PI-15 / #12 recovery pass (2026-08-05)

Scope: validate-only recovery on PI-15 (`#12`). No other issue touched. No application code or tests written.

## What was validated
- **Blocker** — PI-08 (`#10`) is `Done` on project #12 (read back), reviewer PASS at `4cfc409`. PI-15's only blocker is satisfied.
- **Plan doc** — `docs/2026-08-04-flow-todo-crossrepo-and-docs.md` covers PI-15 (rows on missing rollback/Windows docs; push proof already demonstrated at `bb5d79e`). Sufficient; unchanged.
- **tickets.md PI-15** — goal, acceptance criteria, and the "no change under `extensions/`" constraint are coherent: the new SETUP.md assertions belong in the new `scripts/install-rollback.test.mjs`, while `extensions/workflow/config-docs.test.ts` (8 tests, currently green) stays unchanged as a regression guard.
- **Issue #12 body** — was stale: claimed "this repository has no GitHub Project; local tracker status remains authoritative", but the item is live on project #12. Corrected to name project #12 as stage authority; goal/criteria not redesigned.

## Defect found and repaired
The published `Verification-command` was **false-green**. `node --test` on Node v22.22.3 silently ignores a nonexistent file path, so

    node --test --experimental-strip-types extensions/workflow/config-docs.test.ts scripts/install-rollback.test.mjs && npm run check

exited **0** today, before any of PI-15's work exists. Hardened to:

    test -f scripts/install-rollback.test.mjs && node --test --experimental-strip-types extensions/workflow/config-docs.test.ts scripts/install-rollback.test.mjs && npm run check

Verified red today: exit **1**. Updated in both `tickets.md` and issue #12.

## Board move
`PVTI_lAHOCFvJwM4BfV__zg1N89w` (#12) `Planned` → `Agent Ready` (option `61e4505c`), read back as `Agent Ready`. Exactly one item moved.

## Next agent
`/coder` starts at **PI-15 / #12**. Write `scripts/install-rollback.test.mjs` first (red), then `SETUP.md`. Do not edit `extensions/`.
