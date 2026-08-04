# PI-11 Debugger Handoff — 2026-08-04

## State

- Ticket: PI-11, reviewer bounce 1 of 3.
- Starting commit: `7e1b3a2` (`6c4ca31` was the implementation parent named by the reviewer).
- Tracker: local `tickets.md`; PI-11 is now **Review Ready**.
- Work stayed in `/Users/vraj/Work/pi-agent`. No subagents, network access, or push were used.

## Audit

The focused red suite reproduced the two reported production failures plus the
direct reading boundary: Codex `0` reached a measured `0% ctx`, non-positive
context readings were accepted, and `app.clear` in a running stage takeover
called `requestAbort`. Static checking also caught a test-only custom-component
typing issue, which was corrected before the final gate.

The four-net audit found no remaining failing tests, type errors, or unrelated
PI-11 invariant violations after the fixes. Existing happy-path coverage was
kept; weak coverage found at the boundaries was strengthened with production
path tests.

## Fixes

- `extensions/subagents/src/backends/codex.ts` now treats only positive finite
  Codex occupancy and context-window values as usable.
- `extensions/shared/stage-progress.ts`, both context formatters, and the
  footer validator reject non-positive occupancy. Unknown readings remain
  indeterminate and stage rows render no `%`; positive readings remain
  measured, with tiny positive readings rendered as `<1% ctx`.
- `extensions/subagents/src/ui/takeover.ts` now snapshots stage-ness before key
  dispatch. Stage takeovers cannot abort or send, including through `app.clear`
  and submit paths, while interrupt/close and scroll paths remain safe. Helpers
  retain abort and send behavior.
- `extensions/subagents/takeover.test.ts` exercises the real
  `openSubagentTakeover` factory path for stage clear/scroll/close and helper
  abort/send behavior.
- Settings red-team coverage now preserves malformed JSON and non-object JSON
  (`null`, array, number, and string) rather than overwriting it.

## Red-team evidence

- Token payloads attacked: zero, negative, `NaN`, positive/negative infinity,
  null, string, object, and missing `last.totalTokens`; all produce
  `tokens: undefined`, an indeterminate reading, and no `%` in the rendered
  stage row.
- Settings attacked: malformed JSON and non-object JSON; installer exits
  non-zero and leaves the original bytes unchanged. Existing legacy migration,
  idempotence, path-with-spaces, backup, and in-place install tests remain green.
- UI key paths attacked: stage `app.clear`, scroll, close, submit, and helper
  `app.clear`/send. Stage mutation calls stayed at zero; helper behavior stayed
  available.
- No `as any` was added.

## Verification

Locked PI-11 gate:

```text
node --test --experimental-strip-types extensions/workflow/policy.test.ts extensions/workflow/flow-panel.test.ts extensions/ui-customization/footer.test.ts extensions/subagents/context-usage.test.ts extensions/workflow/config-docs.test.ts && npm run check && npm test
```

Result: exit 0; 59 targeted tests, TypeScript check passed, 179 Node tests,
and 22 Vitest tests passed.

Additional evidence:

- `NO_COLOR=1 node --test --experimental-strip-types extensions/subagents/context-usage.test.ts extensions/shared/stage-progress.test.ts extensions/subagents/takeover.test.ts` — 27 tests passed.
- `NO_COLOR=1 node --test --experimental-strip-types extensions/workflow/config-docs.test.ts extensions/workflow/policy.test.ts extensions/workflow/flow-panel.test.ts extensions/ui-customization/footer.test.ts extensions/subagents/context-usage.test.ts extensions/subagents/takeover.test.ts` — 63 tests passed.
- `node --test --experimental-strip-types extensions/workflow/flow-panel.test.ts` — 18 tests passed, including the 1,000-render benchmark.
- `npm run format:check` — pass.
- `git diff --check` — pass.

One full-suite run under concurrent test load exceeded the existing 2,000 ms
flow-panel benchmark (3.28 s); the isolated benchmark and the subsequent exact
full suite passed (1.67 s benchmark in that run). This was not a code failure
and is disclosed for reviewer context.

## Next review

Independently review positive-only occupancy semantics at the Codex/parser,
shared-reading, and display boundaries, and verify that takeover close/scroll
remain UI-only while stage sends and aborts stay coordinator-controlled. No
known in-scope follow-up remains.
