# Spec — persistent flow UI + local token savings + Windows portability

Date: 2026-08-04 · Stage: part1 (plan) · Repo: `~/Work/pi-agent`

## Audit (evidence, gathered before planning)

| Claim | Evidence |
| --- | --- |
| Footer already carries a flow rail | `git log --oneline` → `baf5272 ui: move workflow rail into footer`; `extensions/ui-customization/index.ts` `setFooter` renders 3 lines (cwd/runtime, rail, usage/PR) |
| Per-agent detail is not in the footer | Footer shows only `route · status`; agent rows exist only in `FlowPanel.agents()` (`extensions/workflow/index.ts`) and as `N running · N tracked` in the header |
| Subagent summaries carry no stage identity | `WorkflowSubagentSummary` in `extensions/shared/workflow-state.ts` has `id/title/status/backend/modelLabel/contextTokens/contextWindow/turns` — no stage, no start time |
| Ponytail is installed but undocumented here | `~/.pi/agent/settings.json` → `"packages": ["git:github.com/DietrichGebert/ponytail", ...]`; source at `~/.pi/agent/git/github.com/DietrichGebert/ponytail` (v4.8.4, ships `pi-extension/` + 6 skills). `grep -ril ponytail` over this repo: no hits. `SYSTEM.md`/`README.md` never mention it. |
| Caveman is not wired into Pi | Exists only at `~/.claude/skills/caveman` (Claude Code). `ls ~/.pi/agent/skills` → `background-terminals`, `subagents` only |
| A third-party proxy already sees Anthropic traffic | `~/.pi/agent/models.json` → `anthropic.baseUrl = https://agentrouter.org` with an API key (runtime-only, git-ignored) |
| RTK/Caveman *proxy* compression = OmniRoute feature | `~/.hermes/node/lib/node_modules/omniroute/README.md` — "RTK + Caveman compression saves 15–95% tokens". Installed under `~/.hermes` only; not connected to Pi |
| "Headroom proxy" | No artifact found anywhere on disk (`grep -ril headroom` over `~/.pi`, `~/.claude/skills`, `~/Work/pi-agent` → no hits). Not assessable from local evidence; **out of scope** under the locked decision |
| Baseline gate is green | `npm run check` → tsc clean; `npm test` → 22 tests passed |
| No git remote, no matching GitHub Project | `git remote -v` → empty. `gh project list --owner @me` → X-Agent, Vraj-Website, WGS, Surf-Royale, Media-Agent, Lullabook — none for pi-agent |

**Tracker mode: local-file (`tickets.md`).** `gh` is authenticated with `project` scope, but this repo has no remote and no board. Tickets below are the tracker. Creating a remote is a user action, not mine (see Blocker).

## Locked decisions (from the user)

1. **Adaptive footer** — 3 base lines always; one row per tracked part1–part4 agent, shown only while that agent exists; max 4 rows (7 lines total).
2. **Measured percent + ticket-based percent** — percentages only from a real denominator: context tokens/window, question `k/N`, stage `k/4`, and tickets done/total from the tracker. Everything else is indeterminate.
3. **Local-only token savings, and the whole workflow must run on Windows.** No new proxy, no new network hop. Ponytail/Caveman/prompt-cache work stays local. Windows support is a first-class deliverable.

## Invariants (testable; `/part3` attacks these, `/part4` grades them)

- **INV-1 no-false-progress.** No percentage is rendered unless the same reading carries the numerator *and* denominator it was computed from. Absent a denominator the UI shows glyph + elapsed + turns and no number that could be read as completion.
- **INV-2 no-secret.** No API key, token, cookie, auth header, provider base URL, or `.env` value ever reaches the footer, `/flow`, OS notifications, `tickets.md`, or a handoff. Task previews and agent titles are truncated and secret-pattern scrubbed before display.
- **INV-3 render is pure and fast.** The footer render path performs no filesystem, network, or subprocess I/O and completes in **≤2 ms at width 200** (p95 over 1000 renders). All external reads happen off the render path.
- **INV-4 bounded footprint.** Footer ≤7 lines and ≤4 stage rows, every line truncated to the terminal width, never wrapped, at any width ≥20 columns.
- **INV-5 staleness is visible.** A reading older than **30 s** renders dimmed with a `~` prefix. Stale data is never presented as current.
- **INV-6 degrade, never fabricate, never crash.** Tracker missing/unparseable, `gh` unauthenticated, or a refresh exceeding its **1 s** timeout → that reading becomes indeterminate (not `0%`, not last-known-good past the staleness window). Any throw inside the footer renderer is caught and the base 3 lines still render.
- **INV-7 portability.** No macOS-only assumption on the shipped path. Notification and installer paths degrade to a logged no-op on an unsupported platform instead of throwing.
- **INV-8 no new trust edge.** Phase 2 adds no proxy, no new prompt-carrying network hop, and does not change provider routing.

### Latency / cadence budgets

| Path | Budget |
| --- | --- |
| Footer render | ≤2 ms @ width 200 |
| `/flow` open | ≤50 ms |
| Tracker refresh cadence | ≥5 s between reads |
| Tracker read timeout | ≤1 s → indeterminate |
| `gh` call timeout (if a board is ever configured) | ≤2 s → indeterminate |
| Staleness threshold | 30 s |

### Failure modes

| Dependency | Down / slow / garbage | User sees |
| --- | --- | --- |
| `tickets.md` | missing, unreadable, malformed | ticket percent hidden; rail unaffected |
| Subagent bridge | timeout (already 10 s) | stage row shows `×` + reason in `/flow`; footer stays bounded |
| `gh` | unauthenticated / no scope | ticket percent hidden; `/flow` states the reason once |
| OS notifier | absent (`notify-send`, BurntToast) | silent no-op; TUI + title remain authoritative |
| Extension throw | any | base 3 footer lines render; error surfaced in `/flow`, TUI does not crash |

## Phase order

**Phase 1 (UI): PI-01 → PI-05.** **Phase 2 (tokens/portability): PI-06 → PI-08.**
Phase 2 must not start before PI-04 lands, so token work is never blamed for UI regressions.

## Out of scope (explicit)

Headroom proxy, OmniRoute/RTK proxy compression, CodeGraph or any external structural-retrieval service — all excluded by decision 3 (INV-8). A future part1 run may reopen them as investigate-only.
