# Handoff — Debugger PI-29 bounce 1

**Stage:** Debugger (bounce-1 fix)
**Model:** DeepSeek V4 Flash via OpenRouter (session-approved)
**Date:** 2026-08-05
**Ticket:** PI-29 (#26) — Definitions in settings (read/write workflow.routines)
**Board:** GitHub Project #12, local-file tracker (`tickets.md`)
**Commit:** `f89cfd14cba58668158ad1fdf55c8730a1bbc921`
**Remote proof:** `origin/main` read back `f89cfd14cba58668158ad1fdf55c8730a1bbc921` after `git fetch origin`

## Reviewer findings fixed

### 1. `snoozedUntil` silently dropped on read/write

**Root cause:** `RoutineDefinition` interface and `validateRoutine` in `routines-settings.ts` had no `snoozedUntil` field. The spec (`docs/2026-08-05-routines-spec.md`) defines it as an optional epoch-ms timestamp for the snooze feature (PI-30).

**Fix (test-first):**

- Added `readonly snoozedUntil?: number` to `RoutineDefinition` interface.
- `validateRoutine` now handles `snoozedUntil`:
  - Valid: finite positive number → preserved as-is.
  - `null` or absent → `undefined` (not set on output).
  - Invalid (`NaN`, `Infinity`, negative, `0`, string, object) → dropped with a warning per entry; the entry itself is kept (per-entry isolation).
- `normalizeRoutine` preserves `snoozedUntil` on write when present.
- Added 6 tests: valid snoozedUntil, null → undefined, absent → undefined, 5 invalid variants dropped with warning, invalid doesn't drop valid sibling, round-trip stability (read → write → read), write output preservation.

### 2. Verification-command typo

**Root cause:** The PI-29 Verification-command in `tickets.md` (and the issue body) referenced `routine-definitions.test.ts`; the actual file is `routines-settings.test.ts`.

**Fix:** Corrected to `extensions/workflow/routines-settings.test.ts` in the PI-29 block of `tickets.md`. Posted a correction comment on issue #26 (`gh issue comment 26 --repo VrajGupta/Pi-Setup`).

## Changed paths

| Path | Change |
|------|--------|
| `extensions/workflow/routines-settings.ts` | Added `snoozedUntil` to interface, validation, and normalizeRoutine |
| `extensions/workflow/routines-settings.test.ts` | Added 6 snoozedUntil tests + updated round-trip test to include snoozedUntil |
| `tickets.md` | Corrected Verification-command typo; updated PI-29 status to Review Ready; appended delivery block |

## Gate evidence

```
node --test --experimental-strip-types extensions/workflow/routines-settings.test.ts
  → exit 0 (47/47 pass, 415 ms)

npm run check
  → exit 0 (tsc --noEmit clean)

npm run format:check
  → exit 0
```

## Product diff SHA-256

`1d2115f93143278edeae3e5267eecc6ecac4b222f2a454ffa6ed9ccdb8a9a3e3`
(working tree diff from HEAD `b6bd72d`)

## Next

- Only the independent reviewer may mark Done.
- Route: **Review Ready** (`tickets.md` PI-29 Status updated).
- The scheduler (PI-28) may read `snoozedUntil` from routine definitions; it is now exposed.