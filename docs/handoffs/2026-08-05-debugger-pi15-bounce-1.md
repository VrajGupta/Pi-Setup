# Debugger handoff — PI-15 / #12 reviewer bounce 1 (2026-08-05)

## Scope and state

- Ticket: PI-15 / `VrajGupta/Pi-Setup#12` only.
- Reviewer bounce: 1 of 3. Blocking finding: a retry after a partial move could
  delete a resource that had already been restored.
- Starting tree: `84cbb05` (`main`), clean. Project item
  `PVTI_lAHOCFvJwM4BfV__zg1N89w` was read back as `Debugging` before edits.
- No subagents were used. No `extensions/` path or other ticket was touched.

## Four-net audit

- Failing tests: none at baseline; the exact PI-15 gate passed with 9 tests.
- Static errors: none; `npm run check` passed before the repair.
- Invariant defect: the documented POSIX and PowerShell loops inferred
  “originally absent” from a saved entry that could have been consumed by an
  interrupted earlier attempt. The reviewer reproduced POSIX data loss with
  `actual false`, `expected true`; PowerShell had the same state transition by
  inspection.
- Weak evidence: the existing fixture tested only a second run after
  `.rollback-complete`, not a retry after one saved resource had moved.

## Repair

- `SETUP.md` now creates `.rollback-manifest` atomically before the first move.
  It contains one marker per managed resource: `.present` or `.absent`.
- On retry, a consumed `.present` entry with an existing target is treated as
  already restored and is left intact. If that target is missing, rollback
  fails closed. `.absent` entries still remove installer-created targets.
- The PowerShell procedure mirrors the same manifest creation, partial-retry,
  absent-resource, completion-marker, and path-validation semantics.
- The regression extracts the documented POSIX command, injects deterministic
  exit 73 immediately after the `extensions` saved entry is moved, then runs
  the unmodified command again and checks byte restoration and safe completion.

## Verification

- Exact gate after the repair: `test -f scripts/install-rollback.test.mjs &&
node --test --experimental-strip-types
extensions/workflow/config-docs.test.ts scripts/install-rollback.test.mjs &&
npm run check` → pass; 9 tests; TypeScript clean.
- `npm run format:check` → pass.
- `npx prettier --check SETUP.md scripts/install-rollback.test.mjs` → pass.
- `git diff --check` → pass.
- `sh -n install.sh` → pass.
- No fixed sleeps or delay calls; the focused rollback regression completed in
  about 110 ms on this runner.
- PowerShell is unavailable on this macOS runner; the PowerShell branch was
  checked statically and the test asserts its manifest/fail-closed markers.

## Delivery

- Local mirror: PI-15 is `Review Ready`.
- Project item transition: `Debugging` → `Review Ready`; project read-back:
  `PVTI_lAHOCFvJwM4BfV__zg1N89w status=Review Ready`.
- Implementation commit: `15b19171906ef0860bcde21c87a6c351888c3669`.
- The final handoff update commit and its fetched/direct remote read-back are
  reported with the delivery evidence.

- Next stage: independent reviewer.
