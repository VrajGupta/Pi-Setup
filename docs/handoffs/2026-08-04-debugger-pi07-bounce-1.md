# PI-07 debugger handoff — reviewer bounce 1 recovery · 2026-08-04

## Scope and starting state

- Ticket: PI-07 / GitHub issue #9, PR #14, branch `debugger/pi-07`.
- Starting head: `0694cd9313d26c9cb76813aecf4ed11123841fc4`.
- Project #12 item `PVTI_lAHOCFvJwM4BfV__zg1N89Y` was read back as `Debugger Ready`,
  then moved to `Debugging` and read back before any edit. Only PI-07 moved.
- PI-09 remained `Agent Ready`; PI-06 remained `Done`; PI-11 remained `Reviewing`.
- The supplied reviewer anchor `5178770765` was not found by GitHub. The live
  durable reviewer verdict is
  [comment 5178724721](https://github.com/VrajGupta/Pi-Setup/issues/9#issuecomment-5178724721).

## Four-net audit

- **Failing tests:** none at baseline. The locked gate passed with 16 targeted
  tests and clean TypeScript.
- **Static errors:** none. `tsc --noEmit` passed; the repository has no separate
  lint script.
- **Invariant violation:** `redactPromptText` did not recognize the common
  `AWS_ACCESS_KEY_ID` label. The reviewer trigger was
  `AWS_ACCESS_KEY_ID=SYNTHETIC_ACCESS_VALUE`; the synthetic value remained in the
  stable prefix and full assembled prompt, violating PI-07's no-credential
  acceptance criterion and INV-2.
- **Weak coverage:** the existing production seam check only inspected source
  text, and no runtime `before_agent_start` test exercised an AWS-style
  credential label.

## Test-first fix

The new regression was added first and run red through the registered production
`before_agent_start` callback. The result was 10 passing tests and 1 failing test;
the failure was the expected `assert.doesNotMatch(result.systemPrompt, /SYNTHETIC_/)`
assertion, with the synthetic AWS value still present.

The smallest production fix adds `aws[_-]?access[_-]?key[_-]?id` to the existing
named-credential matcher. The runtime seam regression now proves that the value is
absent from the prompt returned by the actual production callback.

## Red-team coverage

Synthetic-only probes passed for AWS credential casing and separators, quoted and
whitespace-delimited values, Unicode, repeated lines, folded sensitive headers,
ordinary neighboring text, and stable-prefix determinism. The adjacent
`AWS_SECRET_ACCESS_KEY` form was also checked and is already covered by the
existing `access_key` matcher. No real credential, prompt, provider call, or
helper was used.

## Evidence

Locked gate after the final code edit:

```text
node --test --experimental-strip-types extensions/workflow/prompt-assembly.test.ts extensions/workflow/policy.test.ts && npm run check
→ exit 0; 17 tests passed; tsc --noEmit passed
```

Native checks:

```text
npm run format:check → pass
git diff --check → pass
npm test → 196 Node tests passed; 22 Vitest tests passed
```

No in-scope follow-up remains. After remote proof, move PI-07 from `Debugging` to
`Review Ready`; do not mark it `Done`. The reviewer should inspect the matcher
boundary and the runtime production-seam regression, then rerun the locked gate.
