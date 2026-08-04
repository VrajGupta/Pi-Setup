# Handoff — debugger → reviewer · PI-05 folded-header recovery · 2026-08-04

## Scope and routing

PI-05 was explicitly authorized for one targeted recovery after reviewer bounce
3/3. The local tracker route was `Reviewing` → `Debugging` → `Review Ready`;
only PI-05 moved. This repository has no GitHub Project and no git remote. No
helper, provider call, or push was used.

## Four-net audit

- **Failing tests:** the baseline exact PI-05 gate was green (23 targeted tests;
  TypeScript clean). The new regression was intentionally red before the fix:
  both folded continuation values survived into the rendered `waiting on` and
  `event` rows.
- **Static errors:** none before or after the fix; `tsc --noEmit` stayed clean.
- **Invariant violation:** INV-2 was broken because
  `SENSITIVE_HEADER_PATTERN` stopped at every newline while `displayText`
  flattened newlines only afterward. A continuation line beginning with space
  or tab was therefore rendered as ordinary text.
- **Weak coverage:** no production-seam regression covered folded
  Authorization or Cookie continuations. Added both exact synthetic cases,
  including ordinary neighboring text and an ordinary neighboring header. No
  additional in-scope invariant violation or unfixed follow-up was found.

## Fix

`extensions/workflow/index.ts` now treats `CRLF/LF` followed by horizontal
whitespace as part of the preceding opaque Authorization/Cookie span. The span
ends before the next non-indented line or another sensitive header and is
replaced with one `Authorization: [REDACTED]` or `Cookie: [REDACTED]` placeholder.
The matcher does not parse or validate quotes, delimiters, or secret values.

`extensions/workflow/flow-panel.test.ts` adds the folded Authorization and
Cookie regressions. Existing balanced/malformed same-line cases remain intact.

## Evidence

- `node --test --experimental-strip-types extensions/workflow/flow-panel.test.ts extensions/workflow/policy.test.ts && npm run check` → exit 0; 24 targeted tests passed; TypeScript clean.
- `npm run format:check` → exit 0.
- `git diff --check` → exit 0.
- Direct inline production `FlowPanel.render` probe → exit 0. It checked folded,
  balanced, malformed, neighboring, terminal-control, URL, width 40/120, and
  indeterminate-progress behavior.

## Next

PI-05 is `Review Ready` in `tickets.md`. Reviewer should inspect the scoped
matcher and the two folded-header regressions blind, then rerun the exact gate.
