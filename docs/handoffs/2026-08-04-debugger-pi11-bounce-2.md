# PI-11 Debugger Handoff — 2026-08-04

## Scope

- Ticket: PI-11, after reviewer bounce 2.
- Starting commit: `2e2ce91` (`review: bounce PI-11 tiny context telemetry`).
- Tracker: local `tickets.md`; no GitHub Project is configured.
- Destination: Review Ready; no push performed.
- Work stayed in `/Users/vraj/Work/pi-agent`; no subagents were used.

## Red-team finding and fix

The reviewer reproduction was valid: `formatContextUtilization({ tokens: 1, contextWindow: 200_000 })` returned `0%/200k`. `contextPercent()` rounded a real positive sub-1% reading down to zero, and both the subagent dashboard row and stage takeover header consumed that shared formatter.

The shared subagent formatter now preserves a positive fractional percentage internally and renders it as `<1%/capacity`. Existing measured percentages at or above 1% retain integer formatting. Invalid, zero, negative, non-finite, and missing occupancy remains unknown as `?/capacity`; an invalid capacity still omits the statistic. The stage takeover read-only behavior was not changed or weakened.

Regression coverage now includes:

- the shared formatter’s direct tiny-positive, ≥1%, and invalid-input semantics;
- actual dashboard rendering with a Unicode title, truncation, visible-width checks, and no `0%`;
- actual stage takeover header rendering with a Unicode title, visible-width checks, and no `0%`.

## Audit result

- Failing tests: the new direct formatter assertion and both consumer assertions first reproduced `0%/200k`; all passed after the formatter fix.
- Static errors: none; TypeScript check passed.
- Invariant audit: no valid positive measured usage renders `0%`; unknown readings contain no `%`; dashboard and takeover lines remain width-bounded; the stage takeover remains read-only for clear, typed input, abort, and relay paths.
- Weak-test audit: consumer-level coverage was missing for the dashboard and takeover despite the utility test; those cases are now covered without `as any`.
- No unrelated PI-11, PI-16, PI-12, or PI-10 implementation paths were changed.

## Verification evidence

Exact PI-11 gate:

```text
node --test --experimental-strip-types extensions/workflow/policy.test.ts extensions/workflow/flow-panel.test.ts extensions/ui-customization/footer.test.ts extensions/subagents/context-usage.test.ts extensions/workflow/config-docs.test.ts && npm run check && npm test
```

Result: 60 targeted Node tests passed; `npm run check` passed; full suite passed with 182 Node tests and 22 Vitest tests; exit 0.

Additional checks:

- `node --test --experimental-strip-types extensions/subagents/context-usage.test.ts extensions/subagents/takeover.test.ts` — 16 passed.
- `npm run format:check` — pass.
- `git diff --check` — pass.
- `rg -n 'as any' extensions/subagents` — no matches.
- Read-only takeover source audit — stage `app.clear` cannot abort, stage input cannot send, and helper abort/send behavior remains separate.

## Handoff

PI-11 is marked **Review Ready** in `tickets.md`. Commit the verified change locally and leave the tree clean; do not push. Reviewer should inspect the sub-1% formatter branch and the dashboard/takeover consumer regressions.
