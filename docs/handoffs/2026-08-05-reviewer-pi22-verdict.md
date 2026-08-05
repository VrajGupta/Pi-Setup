## Review: PASS  (score: 91/100, diagnostic only)
Bounce: 0 of 3
Gate: `node --test --experimental-strip-types extensions/workflow/tracker-poll.test.ts extensions/workflow/issue-list.test.ts && npm run check` → exit 0 (18 tests; tsc clean)
HEAD: `80efc2c` (verified)
Diff reviewed: `git diff f953ef1..HEAD -- extensions/workflow/tracker-poll.ts extensions/workflow/tracker-poll.test.ts extensions/workflow/issue-list.test.ts settings.example.json`
(Blind: maker handoffs not read.)

### Per-criterion evidence

1. **Interval 2000 / 10000 ms → 5 reads** — `tracker-poll.ts:211-217` reschedules fixed `clampedInterval`; test `tracker poll: each settled interval invokes one read` asserts `readCount === 5`.
2. **Never-settling single-flight** — `performRead` gated by `isInFlight` (`:166-167`); timeout path does **not** clear in-flight (`:169-174`), only late `settle` does (`:148-151`). Test: 10 intervals → `maxActive === 1`, `calls === 1`. Probe: hung forever after timeout still `calls === 1`.
3. **Reject preserves prior + reason, no throw** — `recordFailure` spreads prior snapshot (`:116-125`); reject handler via `settle` (`:193-198`). Test: reason `repo missing`; thrown path asserts `capturedAt` preserved.
4. **Timeout abandon + later tick** — timeout sets `reason: "timeout"` without applying late success (`:169-174`, `:148-151` ignores result when `timedOut`). Test resolves slow read then asserts third call. (Late settle frees slot; hang keeps single-flight — required by criterion 2.)
5. **stop() kills further reads** — `stop` sets `isStopped`, clears interval + active timeout (`:226-237`); `tick`/`performRead` bail on `isStopped`. Test: `pendingCount === 0`, no further reads over 20s.
6. **trackerPollMs clamp** — `clampInterval` (`:27-38`): non-number/non-finite → 10000; range `[2000, 300000]`. Test matrix covers 0→2000, 1e9→300000, absent/string/NaN/±Inf→10000. `settings.example.json` documents `workflow.trackerPollMs: 10000`.
7. **capturedAt + INV-10 repo isolation** — success stores `capturedAt: now()` (`:136-141`); foreign/unavailable results cannot replace prior records (`:128-134`, test `unavailable or foreign repositories…`). `issue-list.test.ts` keeps multi-repo `unavailable — <reason>` + stale `~` coverage (INV-5/10 render seam).

### Invariants
- **INV-13**: fixed interval, single-flight skip, off-render module, timeout/fail preserve + reason, unref + stop clear — held in module.
- **INV-10**: failed/foreign repo does not clobber prior records; capture timestamp on store.
- **INV-5**: not rendered here; existing `issue-list` stale `~` test still in gate.
- **INV-3**: poller is not render; no fs/net/subprocess in module (source purity test).

### Blocking findings
none

### Advisory
- Issue What-to-build mentions wiring `stop()` to `session_shutdown` in `extensions/workflow/index.ts` and reading `workflow.trackerPollMs` at the call site. This diff ships the poller API + settings example only; no production caller yet. Numbered ACs 1–7 and Verification-command are module-scoped and met. Wire-up belongs with the consumer ticket (PI-23+) unless product wants a live orphan poll now.
- Reject-path test does not assert `capturedAt` equality; timeout/throw tests do.

### Routing
→ **Done** — gate green, all numbered acceptance criteria evidenced, no blocking defect.
