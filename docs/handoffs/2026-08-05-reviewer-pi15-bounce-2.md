# PI-15 reviewer verdict — bounce 2 of 3

- Ticket: PI-15 / #12
- Verdict: **FAIL** (72/100, diagnostic only)
- Route: `Reviewing` → `Debugger Ready`; Project #12 item `PVTI_lAHOCFvJwM4BfV__zg1N89w` read back `Debugger Ready`
- Reviewed product range: `84cbb05..15b1917`; tip `15b19171906ef0860bcde21c87a6c351888c3669`
- Product diff SHA-256 (`SETUP.md`, `scripts/install-rollback.test.mjs`, `tickets.md`): `0da98741cae9a77c6fe2651df649a5cd9b71dfc25ec0a43420969b8ca56852c9`
- Scope read-back: `SETUP.md`, docs/tracker evidence, and `scripts/install-rollback.test.mjs`; no `extensions/` change
- Remote evidence: reviewed tip is an ancestor of fetched `origin/main` at `9eb1ef572dd606ea0c466f0ef00d6061efe5dbd0`

## Gate

`test -f scripts/install-rollback.test.mjs && node --test --experimental-strip-types extensions/workflow/config-docs.test.ts scripts/install-rollback.test.mjs && npm run check` → exit 0; 9 tests passed; TypeScript clean. Log: `/tmp/pi15-review-gate.log`.

Additional checks:

- `npm run format:check` → exit 0
- `git diff --check 84cbb05..15b1917` → exit 0
- Fixed-sleep scan → 0 matches
- Strong secret-shape scan → 0 matches
- PowerShell unavailable; rollback block inspected statically

## Blocking finding

- **Corner behavior / rollback integrity:** `scripts/install.mjs:205-208` leaves an already-correct symlink unchanged and therefore writes no backup entry. `SETUP.md:54-60,77-78` infers that a missing backup entry means the resource was originally absent and removes the target. Trigger: install with `~/.pi/agent/extensions` already symlinked to this checkout, then run the documented rollback. Result: rollback deletes the originally present symlink instead of restoring the pre-install state. The deterministic production-seam probe exited 1 with `extensions_exists_after_rollback=false`; log: `/tmp/pi15-review-unchanged-resource-probe.log`.

## Recovery

Teach the rollback evidence to distinguish installer-unchanged resources from originally absent resources, and extend the single rollback regression to cover that real installer path on POSIX. Mirror the state distinction in PowerShell. Preserve the repaired interrupted-retry behavior and path validation.
