# Handoff — debugger → reviewer, PI-09 (2026-08-04)

## State

- Ticket: PI-09 / GitHub issue #11 / PR #15 / branch `debugger/pi-09`.
- Project #12 item `PVTI_lAHOCFvJwM4BfV__zg1N89o` was read back as `Debugging`
  before the audit. PI-07/#9 is `Review Ready`; PI-06/#2 is `Done`; PI-11/#1
  is `Reviewing`.
- The reviewer-bounce repair is intact: the protected-path guard compares
  `git diff --quiet "$(git merge-base HEAD origin/main)" HEAD --
  settings.example.json install.sh SYSTEM.md package.json`.
- The evaluation document remains unchanged. No provider route, configuration,
  credential, real prompt, or proxy process was changed.

## Four-net audit

- **Failing tests:** none. The exact document-only gate passed at baseline.
- **Static errors:** none; `tsc --noEmit` passed. Formatting and diff checks
  were clean; this project has no `lint` script.
- **Invariant violations:** none found. The branch's committed diff is limited
  to `docs/` and the tracker metadata; the protected paths are byte-identical
  to the merge base. The evaluation cites sources, distinguishes vendor claims
  from Pi reproduction, explains cache uncertainty, names the full request and
  trust edges, places Headroom locally for analysis, and ends with the exact
  verdict plus an adjacent next step.
- **Weak coverage:** the verification command is intentionally a shell/document
  gate because PI-09 has no runtime implementation. Its existence, exact
  verdict, and base-relative protected-path checks are exercised directly. The
  newest coder handoff also records the synthetic committed protected-path
  mutation being rejected by the corrected guard; no new config test or config
  change is warranted.

## Red-team pass

- Missing evaluation file and invalid verdict probes fail as required.
- A base-relative diff sees the committed evaluation-document change, while the
  protected-path comparison exits clean on the actual branch.
- Static review found no credentials, secret-shaped values, or real prompts in
  the evaluation. Public source links and vendor claims are labeled; unknown
  cache behavior is not presented as measured.
- There is no runtime dependency, persistence, retry, race, permission, tenant,
  or provider path in this documentation-only ticket. No new trust edge was
  introduced; the document explicitly describes existing and hypothetical edges
  without configuring either proxy.

## Changes

- No implementation or evaluation-document fix was required.
- Added this debugger handoff only. The evaluator remains document-only and the
  corrected guard remains base-relative; no config/provider changes were added.

## Verification

Exact PI-09 gate after the final edit:

```text
test -f docs/2026-08-04-proxy-evaluation.md && grep -Eq "^Verdict: (adopt|reject|needs a further spike)$" docs/2026-08-04-proxy-evaluation.md && git diff --quiet "$(git merge-base HEAD origin/main)" HEAD -- settings.example.json install.sh SYSTEM.md package.json && npm run check
→ exit 0; document/verdict checks passed; protected paths clean; tsc --noEmit passed
```

Native checks:

```text
npm test → exit 0; 190 Node tests and 22 Vitest tests passed
npm run format:check → pass
git diff --check → pass
```

## Delivery

- Intended next status: `Review Ready`; reviewer remains the only stage allowed
  to mark the ticket `Done`.
- Reviewer should rerun the corrected base-relative gate against PR #15 and
  confirm that the evaluation document stays unchanged and documentation-only.
