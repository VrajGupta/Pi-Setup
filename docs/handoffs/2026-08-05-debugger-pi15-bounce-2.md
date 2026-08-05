# Debugger handoff — PI-15 / #12 reviewer bounce 2

## Scope and routing

- Ticket: PI-15 / `VrajGupta/Pi-Setup#12` only.
- Claimed `PVTI_lAHOCFvJwM4BfV__zg1N89w`: `Debugger Ready` → `Debugging`, then
  `Debugging` → `Review Ready`; final Project read-back is `Review Ready`.
- No PI-11 work, settings/auth/session restoration, provider changes, secrets, or
  `extensions/` changes.
- Bounce budget: 2 of 3; this is the second debugger repair pass after independent
  reviewer findings.

## Bounce history

1. Coder delivery passed the original gate at `07ad770`; handoff was
   `docs/handoffs/2026-08-05-coder-pi15.md`.
2. Reviewer bounce 1 found that consuming a saved resource erased provenance, so an
   interrupted rollback retry could delete the restored original. Debugger repair
   `15b1917` added resumable `present`/`absent` manifest behavior; the independent
   retry regression passed. Final bounce-1 handoff: `docs/handoffs/2026-08-05-debugger-pi15-bounce-1.md`.
3. Reviewer bounce 2 (`docs/handoffs/2026-08-05-reviewer-pi15-bounce-2.md`, review
   tip `a6ac9a9`) found that an installer-unchanged symlink had no backup entry and
   was therefore inferred to be originally absent. The reviewer probe exited 1 with
   `extensionsExistsAfterRollback=false`.

## Repair

The installer now creates an atomic `.rollback-manifest` in each backup before any
managed resource move. Every resource is explicitly recorded as:

- `present` — the pre-install entry is moved into the backup;
- `unchanged` — the target already resolves to the checkout and is not moved;
- `absent` — no pre-install target exists.

The POSIX and PowerShell rollback procedures consume those same states. They preserve
`unchanged`, remove only explicit `absent`, restore `present`, and fail closed when a
provenance manifest is missing or a consumed `present`/`unchanged` target is missing.
The existing interrupted retry behavior remains intact; the procedure never keeps an
ambiguous missing target merely because it might have existed.

The focused production-seam fixture uses one temp agent with an unchanged `extensions`
source symlink, an interrupted `skills` restore, and truly absent `themes`. It verifies
the three manifest states, byte restoration, retry safety, absent-resource removal,
non-restored settings/auth/models/sessions, path traversal rejection, and repeat
completion without fixed sleeps. The repaired reviewer probe reported
`extensionsExistsAfterRollback=true` and `unchangedMarker=true`.

The issue body and `tickets.md` now state the narrowly scoped installer-manifest
amendment honestly; the fixture remains `scripts/install-rollback.test.mjs` and the
ticket still has no `extensions/` diff.

## Verification evidence

- Exact ticket gate: `test -f scripts/install-rollback.test.mjs && node --test --experimental-strip-types extensions/workflow/config-docs.test.ts scripts/install-rollback.test.mjs && npm run check` → exit 0; 9 tests passed; `tsc --noEmit` passed. The focused rollback test completed in about 100 ms.
- `npm run format:check` → pass.
- Focused `npx prettier --check SETUP.md scripts/install.mjs scripts/install-rollback.test.mjs` → pass.
- `git diff --check` and `sh -n install.sh` → pass.
- Scope/safety checks → pass: changed paths are only `SETUP.md`, `scripts/install.mjs`, `scripts/install-rollback.test.mjs`, and `tickets.md`; no `extensions/` or PI-11 paths, fixed sleeps, or strong secret shapes.
- PowerShell was unavailable on macOS; its manifest states, direct-child validation,
  fail-closed retry branches, and `Get-Item` handling were inspected statically.

## Commit and remote proof

- Implementation diff: `a6ac9a9..10c72c2`; four files, 120 insertions and 43
  deletions; product diff SHA-256:
  `52c8b7ae09dd9ff8a801e35667b8e961ec0a571dd57a01c9fe5dfe928b75c866`.
- Implementation commit: `10c72c2c3d3eb67c2ea84340c354a29e47f84f27`
  (`fix(pi-15): preserve unchanged rollback resources`, `Refs: #12`).
- Push read-back after fetch: local `HEAD`, fetched `origin/main`, and direct
  `git ls-remote origin refs/heads/main` all returned
  `10c72c2c3d3eb67c2ea84340c354a29e47f84f27`.
- Final Project read-back: item
  `PVTI_lAHOCFvJwM4BfV__zg1N89w` is `Review Ready`.

Next: independent reviewer re-checks the documented POSIX/PowerShell rollback and
the scoped installer provenance change; this stage does not close the ticket.
