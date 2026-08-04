# Handoff — coder → debugger, PI-07 scope repair (2026-08-04)

## State

- Issue #9 / Project #12 item `PVTI_lAHOCFvJwM4BfV__zg1N89Y` is being delivered from `Coding`; parent will move it to `Debugger Ready` after the final read-back.
- PI-07's human-authorized scope amendment excludes opaque/rootless colon-delimited userinfo (for example `sip:user:password@example.test`). Global INV-2 remains unchanged; the residual risk is documented.
- PI-09/#11 was implemented in a separate parallel lane and is not included in this branch.

## Built

- Added the source comment defining PI-07's supported credential-redaction boundary and explicit exclusion.
- Added exactly one named scope test documenting the exclusion.
- Preserved the existing production redaction behavior; no new URI syntax handling was added.

## Evidence

Gate:

```sh
node --test --experimental-strip-types extensions/workflow/prompt-assembly.test.ts extensions/workflow/policy.test.ts && npm run check
```

Result: 19 targeted tests passed; `tsc --noEmit` passed.

Native checks: `npm test` passed with 198 Node tests and 22 Vitest tests; `npm run format:check` and `git diff --check` passed.

Relevant commits on PR #14:

- Scope planner repair: `a3a74ba`.
- Scope comment/test: `9bcf4b7fc9d0625113672871a6480d39b502ff07`.
- Remote `origin/debugger/pi-07` was read back at `9bcf4b7fc9d0625113672871a6480d39b502ff07`.

## Self-check

- The source names all supported forms and the excluded SIP example.
- The one scope test makes the exclusion visible without claiming redaction for it.
- No production redaction logic changed in this repair.
- PI-09 files were not staged.

## Next

Move PI-07 to `Debugger Ready`, then run the independent debugger against the amended ticket and PR #14. Reviewer remains the only stage allowed to mark `Done`.
