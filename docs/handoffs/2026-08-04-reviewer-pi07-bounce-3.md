# Reviewer handoff — PI-07 bounce 3

- Ticket: PI-07 / issue #9
- PR: #14, `debugger/pi-07`
- Verdict: **FAIL** (72/100, diagnostic only)
- Bounce: **3 of 3**
- Route: **Human escalation**; Project #12 item `PVTI_lAHOCFvJwM4BfV__zg1N89Y` remains `Reviewing` (`cf38be42`)
- Durable verdict: https://github.com/VrajGupta/Pi-Setup/issues/9#issuecomment-5179272741

## Blocking finding

`extensions/workflow/prompt-assembly.ts:30` redacts URI schemes only when `:` is followed by one or two slashes. A production `before_agent_start` prompt containing an opaque/rootless credential-bearing URI such as an Oracle JDBC connection string retains its synthetic password. The new production tests cover labeled `*_URL`/`*_URI` values and slash-prefixed schemes, so the exact gate stays green without exercising this leak.

## Bounce history

1. `AWS_ACCESS_KEY_ID` assignment leaked; fixed with recognition and a production-seam test.
2. Credential-bearing non-HTTP `.env` URLs leaked; fixed for slash-prefixed URI schemes and `*_URL`/`*_URI` labels.
3. Opaque/rootless credential-bearing URI still leaks.

The absolute no-credential invariant and expanding syntax blacklist are not converging. Human must choose a fail-closed structured boundary or narrow the accepted redaction scope.

## Evidence

- Ticket gate: `node --test --experimental-strip-types extensions/workflow/prompt-assembly.test.ts extensions/workflow/policy.test.ts && npm run check` → exit 0 (18 tests; TypeScript passed)
- Independent production-seam opaque-URI probe → `LEAK`, exit 1
- Native suite: `npm test` → exit 0 (197 Node + 22 Vitest)
- Format: `npm run format:check` → exit 0
- Diff hygiene: `git diff --check $(git merge-base origin/main HEAD)..HEAD` → exit 0
- PI-09 / issue #11 remains `Agent Ready` (`61e4505c`) and was not reviewed

No application code was changed by the reviewer.
