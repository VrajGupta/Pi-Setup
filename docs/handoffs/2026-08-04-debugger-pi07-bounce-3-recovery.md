# PI-07 debugger recovery handoff — reviewer bounce 3/3 · 2026-08-04

## Scope and human decision

- Ticket: PI-07 / `VrajGupta/Pi-Setup#9`; PR #14; branch `debugger/pi-07`.
- Starting head: `9645c7eedf55e805ac15fb03717b61b2c9d54686`; local and
  `origin/debugger/pi-07` matched before recovery.
- Human recovery decision: fail closed on opaque/rootless credential-bearing
  URIs and continue autonomously with the smallest meaningful production-seam
  regression. This is an authorized recovery after reviewer bounce 3/3.
- Project #12 item `PVTI_lAHOCFvJwM4BfV__zg1N89Y` was read back directly as
  `Debugger Ready` / option `87d47039`, moved to `Debugging` / option
  `df73e18b` before edits, and later read back as `Review Ready` / option
  `c70ba11e`.
- PI-09 / issue #11 was not touched. Its direct read-back remains `Agent Ready`
  / option `61e4505c`.

## Trigger and classification

The exact reviewer trigger was the production `before_agent_start` system prompt
text:

```text
CORE connect jdbc:oracle:thin:synthetic-user/SYNTHETIC_OPAQUE_PASSWORD@db.example:1521:app
```

The existing slash-prefixed URI matcher did not recognize the opaque/rootless
form, so `SYNTHETIC_OPAQUE_PASSWORD` survived `assembleWorkflowSystemPrompt`.
This was classified as an **implementation defect**: the shipped production
boundary violated PI-07's absolute no-credential invariant (INV-2), while the
gate lacked the exact production-seam case.

## Debugger audit

- Baseline failing tests: none; the locked gate was green at 18 targeted tests.
- Baseline static errors: none; `tsc --noEmit` passed and the repository has no
  separate lint script.
- Baseline invariant defect: opaque/rootless credential-bearing URI leaked from
  the production seam.
- Baseline weak coverage: no opaque URI regression at the production seam; the
  existing non-HTTP test covered labeled values and slash-prefixed URI forms.

The independent production-seam probe reproduced the leak and exited 1 before
the test edit.

## Test-first fix

1. Added the concrete opaque Oracle URI to the existing production
   `before_agent_start` regression, with `ordinary-before=keep` and
   `ordinary-after=keep` neighbors.
2. Ran the new test red: 11 passed, 1 failed, and the returned prompt still
   contained `SYNTHETIC_OPAQUE_PASSWORD`.
3. Added a structural credential-URI boundary. It recognizes credential-bearing
   userinfo in hierarchical URIs and opaque/rootless `user/password@host` forms,
   then redacts the complete URI token. It does not add another scheme-name
   blacklist. Existing labeled credentials, headers, tokens, query credentials,
   and ordinary neighboring text remain covered.

The focused post-fix probe also confirmed that ordinary `mailto:` text and both
neighbor lines remain visible while the opaque synthetic password is absent.

## Verification

Locked gate after the final code edit:

```text
node --test --experimental-strip-types extensions/workflow/prompt-assembly.test.ts extensions/workflow/policy.test.ts && npm run check
→ exit 0; 18 tests passed; tsc --noEmit passed
```

Native checks:

```text
npm run format:check → exit 0
git diff --check → exit 0
npm test → exit 0; 197 Node tests and 22 Vitest tests passed
```

Changed paths:

- `extensions/workflow/prompt-assembly.ts`
- `extensions/workflow/prompt-assembly.test.ts`
- this recovery handoff

No in-scope follow-up remains. The later reviewer must remain independent; if
another substantive correctness failure is found, stop for human review rather
than looping autonomously again.

## Delivery and next stage

- Intended final state: PI-07 `Review Ready`; do not mark it `Done`.
- The code, focused regression, and this handoff are to be committed and pushed
  on `debugger/pi-07` into the existing PR #14. Final local and fetched remote
  SHA proof is reported by the debugger stage after commit/push creation.
- The reviewer should inspect the structural URI boundary and the production
  seam regression, then rerun the locked gate independently.
