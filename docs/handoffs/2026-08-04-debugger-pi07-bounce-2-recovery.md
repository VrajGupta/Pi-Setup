# PI-07 debugger handoff — reviewer bounce 2 recovery · 2026-08-04

## Scope and claim

- Ticket: PI-07 / GitHub issue #9, PR #14, branch `debugger/pi-07`.
- Starting head: `102b84690bc279625c5e9e6c429836c05f166941`; local and remote matched.
- Project #12 item `PVTI_lAHOCFvJwM4BfV__zg1N89Y` was read back directly as
  `Debugger Ready` / option `87d47039`, then moved to `Debugging` / option
  `df73e18b` and read back before any edit.
- PI-09 / issue #11 was not changed.
- Durable reviewer verdict: https://github.com/VrajGupta/Pi-Setup/issues/9#issuecomment-5178978883
  (bounce 2 of 3).

## Four-net audit

- Failing tests: none at baseline; the exact locked gate passed with 17 targeted
  tests and clean TypeScript.
- Static errors: none. `tsc --noEmit` passed; the repository has no separate lint
  script.
- Invariant violation: a production `before_agent_start` result retained the
  credential marker from a non-HTTP `.env` URL such as
  `DATABASE_URL=postgres://...:SYNTHETIC_DATABASE_PASSWORD@...`, violating PI-07's
  no-credential acceptance criterion and INV-2.
- Weak coverage: the production seam covered AWS-style labels and HTTP(S) URLs but
  had no valid non-HTTP URL, quoted URL, malformed URL, or neighbor regression.

## Test-first fixes

The first new production-seam regression was intentionally run red: 11 of 12
prompt-assembly tests passed while synthetic markers from `postgres`, `rediss`, and
`mongodb+srv` values remained in the returned prompt.

The smallest production fix generalizes the URL redactor from `https?://` to
URI-like schemes with one or two slash separators, covering valid and malformed
non-HTTP forms without adding a parser or dependency. A second red test exposed an
unlabeled malformed `postgres:/...` value; the same URI boundary fix closed it.
The named assignment matcher also now redacts any `*_URL` / `*_URI` value, so
malformed or quoted `.env` assignments fail closed while ordinary neighboring lines
remain visible.

## Red-team coverage

- Valid non-HTTP schemes: PostgreSQL, Redis/Rediss, MongoDB/MongoDB+SRV, AMQP, and
  an unlabelled URI.
- Malformed one-slash URI and malformed labeled `.env` assignment.
- Quoted `.env` URL values.
- URL-like values with ordinary lines before and after them.
- Existing quoted, escaped, whitespace-delimited, folded-header, token, query, and
  HTTP(S) cases remained green.
- All probes used synthetic markers only; no real credential, provider call, or
  helper was used.

## Evidence

Locked gate after the final edit:

```text
node --test --experimental-strip-types extensions/workflow/prompt-assembly.test.ts extensions/workflow/policy.test.ts && npm run check
→ exit 0; 18 tests passed; tsc --noEmit passed
```

Native checks:

```text
npm run format:check → pass
git diff --check → pass
npm test → exit 0; 197 Node tests passed; 22 Vitest tests passed
```

Changed paths:

- `extensions/workflow/prompt-assembly.ts`
- `extensions/workflow/prompt-assembly.test.ts`
- this handoff

No in-scope follow-up remains. The next reviewer should inspect the generic URI
boundary, the `*_URL` / `*_URI` assignment boundary, and the production
`before_agent_start` regression, then rerun the locked gate. If the next review finds
another correctness failure, the documented bounce-3 human-escalation rule applies.

## Delivery

- Final intended Project status: `Review Ready`; direct read-back is recorded after
  the status write.
- Commit and remote SHA proof are recorded in the issue evidence and final stage
  report after push.
