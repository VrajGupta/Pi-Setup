# Handoff — coder → debugger, PI-09 guard repair (2026-08-04)

## State

- Issue #11 / Project #12 item `PVTI_lAHOCFvJwM4BfV__zg1N89o` is being delivered from `Coding`; parent will move it to `Debugger Ready` after the final read-back.
- The evaluation remains documentation-only. No provider route, settings, model configuration, credential, or real prompt changed.
- PI-07 was implemented in a separate parallel lane and is already `Debugger Ready`.

## Built

- Replaced the tautological `git diff --quiet HEAD -- ...` guard in the PI-09 tracker definition with a base-relative comparison:
  `git diff --quiet "$(git merge-base HEAD origin/main)" HEAD -- ...`
- Updated GitHub issue #11 to carry the same guard and explain why it catches committed protected-path changes.
- Kept `docs/2026-08-04-proxy-evaluation.md` unchanged.

## Evidence

Gate:

```sh
test -f docs/2026-08-04-proxy-evaluation.md && grep -Eq '^Verdict: (adopt|reject|needs a further spike)$' docs/2026-08-04-proxy-evaluation.md && git diff --quiet "$(git merge-base HEAD origin/main)" HEAD -- settings.example.json install.sh SYSTEM.md package.json && npm run check
```

Result: the document/verdict checks pass, the base-relative protected-path guard passes for the clean ticket branch, and `tsc --noEmit` passes. A synthetic committed protected-path change was independently rejected by the corrected guard.

Native checks: `npm test` passed with 198 Node tests and 22 Vitest tests; `npm run format:check` and `git diff --check` passed.

Commit/remote: `1ad4c88f86e9e72d8789e4cc55c4b340b3163ee8`; `origin/debugger/pi-09` read back to the same SHA.

## Self-check

- Only tracker metadata and this handoff changed in this repair; the evaluation document remains docs-only.
- The guard compares committed ticket changes against the base branch rather than the current worktree.
- No credentials, real prompts, or provider calls were used.

## Next

Move PI-09 to `Debugger Ready`, then run the independent debugger. Reviewer remains the only stage allowed to mark `Done`.
