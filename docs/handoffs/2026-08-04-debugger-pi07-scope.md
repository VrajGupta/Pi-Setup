# Handoff — debugger → reviewer, PI-07 (2026-08-04)

## State

- Ticket: PI-07 / GitHub issue #9 / PR #14 / branch `debugger/pi-07`.
- Project #12 item `PVTI_lAHOCFvJwM4BfV__zg1N89Y` was read back as `Debugging`
  before the audit. PI-09/#11 stayed `Debugger Ready`; PI-06/#2 stayed `Done`;
  PI-11/#1 stayed `Reviewing`.
- The human-amended boundary was honored. No production redaction pattern was
  widened, no provider/configuration path was changed, and the opaque/rootless
  colon-delimited URI exclusion remains explicit.

## Four-net audit

- **Failing tests:** none at baseline. The coder's exact gate passed with 19
  targeted tests before the debugger edit.
- **Static errors:** none. `tsc --noEmit`, formatting, and diff checks passed;
  this project has no `lint` script.
- **Invariant violations:** none in PI-07's supported boundary. The production
  `before_agent_start` path calls `assembleWorkflowSystemPrompt`; supported
  assignments, headers, token formats, hierarchical/slash-prefixed URIs, and
  query credentials redacted correctly. The excluded
  `sip:user:password@example.test` shape remains deliberately outside the
  ticket guarantee and is documented as accepted residual risk under unchanged
  global INV-2.
- **Weak coverage:** production-seam tests covered AWS assignment and
  credential-bearing URI cases, but not header/token/query families together.
  Added one focused production-seam regression. The one explicitly named scope
  exclusion test remains exactly one.

## Red-team pass

- Exercised empty/Unicode text, malformed and unterminated quoted assignments,
  CRLF and folded headers, adjacent ordinary lines, recognized token formats,
  query credentials, hierarchical URLs, slash-prefixed URLs, and JDBC-style
  slash-delimited URIs.
- Exercised the production seam directly: supported forms were clean,
  neighboring lines survived, the non-TUI path remained a no-op, and the
  excluded rootless URI remained visible as specified.
- No dependency, persistence, race, retry, permission, tenant, provider, or
  network path exists in this pure assembly seam. Source inspection found no
  filesystem, subprocess, or network I/O in `prompt-assembly.ts`.

## Changes

- Added a single test in `extensions/workflow/prompt-assembly.test.ts` covering
  the remaining supported credential families through the production seam.
- No production implementation fix was required. The accepted rootless
  colon-delimited URI gap is not a follow-up defect for PI-07; closing it would
  require a separately planned fail-closed structured-boundary ticket.

## Verification

Exact PI-07 gate after the final edit:

```text
node --test --experimental-strip-types extensions/workflow/prompt-assembly.test.ts extensions/workflow/policy.test.ts && npm run check
→ exit 0; 20 tests passed; tsc --noEmit passed
```

Native checks:

```text
npm test → exit 0; 198 Node tests and 22 Vitest tests passed
npm run format:check → pass
git diff --check → pass
```

## Delivery

- Intended next status: `Review Ready`; reviewer remains the only stage allowed
  to mark the ticket `Done`.
- Reviewer should rerun the exact gate against the pushed PR head and verify the
  supported/excluded boundary without widening PI-07's scope.
