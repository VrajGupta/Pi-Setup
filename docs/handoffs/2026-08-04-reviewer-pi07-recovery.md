# Reviewer handoff — PI-07 recovery

- Ticket: PI-07 / GitHub issue #9
- Reviewed head: `6189bb5b58a3c544ca9b559a0d82938bd191e301` on `debugger/pi-07`; fetched `origin/debugger/pi-07` matched before review.
- Verdict: **FAIL** (64/100, diagnostic only)
- Bounce: 3 of 3 exhausted; this was the human-authorized recovery review.
- Route: **Human escalation**. PI-07 remains **Reviewing**; no automatic bounce. PI-09/#11 remains **Agent Ready** and was not reviewed.

## Gate

- `node --test --experimental-strip-types extensions/workflow/prompt-assembly.test.ts extensions/workflow/policy.test.ts && npm run check` → exit 0 (18 tests; `tsc --noEmit` passed).
- `npm test` → exit 0 (197 Node tests; 22 Vitest tests).
- `npm run format:check` → exit 0.
- `git diff --check $(git merge-base origin/main HEAD)..HEAD` → exit 0.
- Independent production-seam SIP probe → exit 1: the assembled prompt retained the synthetic password marker while preserving both ordinary neighboring lines.

## Blocking findings

- **Invariant integrity:** `extensions/workflow/prompt-assembly.ts:14-24`, reached through `extensions/workflow/index.ts:1008-1030`, recognizes hierarchical `//user:password@…` and slash-delimited opaque `user/password@…` credential forms, but not a valid colon-delimited rootless userinfo form. Trigger: `sip:synthetic-user:SYNTHETIC_SIP_PASSWORD@example.test` in `event.systemPrompt`. Result: `SYNTHETIC_SIP_PASSWORD` reaches the returned production system prompt unchanged, violating PI-07's absolute no-credential criterion and INV-2.
- **Test honesty:** `extensions/workflow/prompt-assembly.test.ts:204-249` covers the recovered Oracle/JDBC slash form but no colon-delimited opaque/rootless credential URI, so the exact gate remains green while the production leak above remains.

## Recovery history

1. Bounce 1 found an `AWS_ACCESS_KEY_ID` assignment leak.
2. Bounce 2 found credential-bearing non-HTTP URL leaks.
3. Bounce 3 found the Oracle/JDBC opaque/rootless URI leak; the human chose fail-closed handling rather than narrowing the invariant.
4. Recovery closes the concrete Oracle/JDBC case, but not the broader opaque/rootless boundary; a valid SIP userinfo form still leaks.

## Review scope

Read issue #9 and acceptance criteria, attributable code/tests, the production caller seam, invariant docs, and durable prior reviewer verdicts. No coder/debugger handoff or PR description was read. An initial evidence command displayed the target commit subject/body; the verdict does not rely on it and is grounded in the independent failing production probe.
