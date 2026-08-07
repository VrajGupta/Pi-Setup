# Vraj Pi

Personal configuration for **Pi**, the terminal agent host this repo installs into
(`~/.pi/agent`). Pi runs **direct-only**: every request is handled by the normal agent
path, with manual subagents, routines, and a truthful todo/status surface below the
prompt. Nothing is classified or routed automatically.

## What this repo is

Everything here gets linked (or copied) into `~/.pi/agent` by `./install.sh`:

- `SYSTEM.md` — coordinator policy: direct-only operation, manual stage sessions, approved model map, invariants.
- `AGENTS.md` — agent rules for this repo: check/format/lint, type safety, test economy.
- `extensions/workflow` — the off-render tracker poll that publishes todo snapshots, `/routine` commands, and the routines scheduler. There is no automatic routing, stage launch, or relay.
- `extensions/ui-customization` — the belowEditor status surface (mode/route/stage rows, issue rows, routines section), compact `π + project` header, technical footer.
- `extensions/subagents` — the multi-harness engine plus the workflow bridge and safe `subagent_send` tool.
- `skills/` — local skill packages (background-terminals, subagents, terse-output).
- `themes/vraj-ink.json` — OLED-black cyan/violet theme with semantic stage colors.
- `keybindings.json` — personal keybinding overrides.
- `SETUP.md` — install, backup, and rollback details.
- `tickets.md` — local mirror of the GitHub Projects board: issue map, statuses, delivery records.
- `docs/` — specs and stage handoffs (every stage boundary is a file-backed handoff here).

Runtime state stays outside git: auth, sessions, trust, live settings, downloaded packages, environment files, and workflow checkpoints.

## Repository layout

```
extensions/<name>/index.ts     # extension entry point (registered when Pi loads)
extensions/<name>/*.ts         # pure modules (renderers, schedulers, settings)
extensions/<name>/*.test.ts    # node:test suites, run with --experimental-strip-types
docs/2026-08-05-*.md          # specs + handoffs per effort/ticket
tickets.md                    # board mirror; the tracker is the authority, this is the local copy
```

## How work flows

Work lives as GitHub issues on a Project board with a strict status pipeline:
`Planned → Agent Ready → Coding → Debugger Ready → Debugging → Review Ready → Reviewing → Done`.
Each status is a handoff boundary; nothing skips a stage and only the independent
reviewer may set `Done`.

1. **Planner** grills the idea, locks decisions and invariants, writes a spec in `docs/`,
   and cuts dependency-ordered tickets (issues + board items).
2. **Coder** picks the next unblocked ticket, builds it test-first against the ticket's
   exact Verification-command, self-checks, and hands off.
3. **Debugger** attacks what the coder built — weird inputs, failure modes, boundary
   violations — fixes real defects test-first, and re-runs the gate.
4. **Reviewer** (blind: never reads maker rationale) judges the diff against the ticket
   and invariants, and routes: pass → `Done`, fail → back with falsifiable findings.

Every stage boundary leaves a bounded handoff in `docs/handoffs/` and advances the
board; each handoff is a claim, never proof — the next stage re-runs the gate itself.

## Token savings (the point of the shebang)

This repo is deliberately built to burn as few tokens as possible. Three levers are
shipped and enforced; nothing here is a vendor claim:

| Lever | What it actually does | Effect |
| --- | --- | --- |
| **Caveman-style terse output** — `skills/terse-output/SKILL.md` + Ponytail | Routine replies drop filler, articles, and pleasantries while keeping full technical accuracy; security warnings, irreversible-action confirmations, and multi-step sequences are never compressed | ~75% fewer tokens on conversation overhead (policy claim, matches the Caveman skill contract) |
| **Prompt-cache-stable assembly** — `extensions/workflow` | The system prompt is split into a byte-identical stable prefix and a volatile route suffix, so provider prompt caches keep hitting across turns instead of re-reading the world every request | Cheaper + faster repeated calls; cache-hit pricing instead of full-prompt pricing |
| **Measured-only telemetry** — INV-1 | No fabricated percentages. Context use comes from exactly three in-process denominators; everything else renders elapsed time + turn count + no number | Honest UI, no token budget wasted on invented metrics |

**What was evaluated and deliberately NOT adopted:** a compressing proxy (RTK/Caveman
compression, Headroom) with vendor claims of 15–95% savings. Those claims were not
independently reproduced; the verdict is `needs a further spike` and Pi never routes
traffic through an unmeasured proxy. Adoption requires a new planner run, new
invariants, and explicit approval — see `docs/2026-08-04-proxy-evaluation.md`.

**Trust boundary:** credentials, API keys, tokens, and provider URLs never reach the
footer, the status surface, handoffs, or third parties (INV-2) — redaction is defense in depth,
not permission to be careless.

## Extending Pi

- **Commands** (`/routine`, …): `extensions/workflow/index.ts` — register with `registerCommand`.
- **Status surface**: `extensions/ui-customization/status-widget.ts` (pure renderer) + `index.ts` (wiring).
- **Scheduled prompts**: add a `workflow.routines` entry in `settings.example.json` (see Routines below).
- **Skills**: `skills/<name>/SKILL.md` — the loader reads these when a task matches.
- **Theme/keybindings**: `themes/vraj-ink.json`, `keybindings.json`.

Run `npm run check` (typecheck), `npm run format:check`, and the ticket's exact
Verification-command before finishing any change (see Checks below).

## Install

```sh
./install.sh
```

The installer backs up current runtime resources before linking this repo into `~/.pi/agent`. Restart Pi or run `/reload` afterward.

## Direct-only operation

Every request is handled by the normal Pi agent path. Nothing is classified, routed, or handed to a
pipeline stage automatically. There is no `/flow`, no `/mode`, no `workflow` tool, no F6 binding, and
no planner/coder/debugger/reviewer rail.

Subagents are **manual**: you spawn them explicitly with the subagent tools when you want one. They
are never selected for you, and no model is chosen on your behalf by a routing decision.

Agent rows show elapsed time, completed assistant turns (`1t` = one turn), and measured context-window use (`<1% ctx`, for example). Context use is not task-completion progress; unavailable usage shows no percentage.

Stage profiles:

| Stage | Harness | Model | Default effort |
| --- | --- | --- | --- |
| planner | Claude Code | Opus 5 | high |
| coder | Pi (OpenCodeGo) | DeepSeek V4 Flash | high |
| debugger | Codex (OpenAI) | GPT-5.6 Luna | max |
| reviewer | Pi (OpenRouter) | Grok 4.5 | high |

Fallbacks (prefer the primary route; a fallback is used only when the primary is
unavailable and is always reported to Vraj before being accepted):

- **planner:** Claude Code with Claude subscription (Opus 5 / Sonnet 5 / Haiku 5; no OpenRouter).
- **coder:** DeepSeek V4 Flash via OpenRouter; fallback OpenCodeGo subscription when OpenRouter quota is reached.
- **debugger:** GPT-5.6 Luna via OpenRouter; fallback OpenAI subscription, then OpenCodeGo subscription when OpenRouter quota is reached.
- **reviewer:** Grok 4.5 via OpenRouter; fallback OpenCodeGo subscription when the OpenRouter daily limit is reached.

These match `STAGE_PROFILES` in `extensions/workflow/src/policy.ts`, which is the pinned source of truth.

A stage child cannot spawn children. It may return a validated `helper_request`; the Sol coordinator brokers sibling helpers and sends bounded results back.

## Status surface

The primary status surface is the **belowEditor** widget — a live panel rendered below the prompt showing any running manual subagents and the active issue rows. The footer handles telemetry only (cwd, runtime/model, usage, git/PR).

The surface carries no mode, route, or stage labels — those concepts no longer exist. The tracker poll interval (`workflow.trackerPollMs`, default 10000) and the surface runaway ceiling (`workflow.statusWidget.maxLines`, default 40) are configurable in `settings.example.json`.

**Subagent picker.** DOWN opens the subagent picker only when a subagent is running; `alt+down` opens it anytime. DOWN opens a view only — sending to a subagent remains the explicit in-view send action (PI-11, INV-20). The picker trigger can be disabled with `workflow.subagentPicker.downArrow: false` in `settings.example.json`.

## Routines

Periodic scheduled prompts (like Claude Code routines) are configured under `workflow.routines` in settings. Each routine has a name, a prompt/task template, and a schedule (fixed interval in ms, with optional `at` minutes-of-day for time-of-day pinning). The scheduler is single-flight per routine and runs off the render path (INV-10, INV-13).

### Commands

- `/routine` — bare picker of available (enabled, not snoozed) routines.
- `/routine run <name>` — classify the routine's prompt and execute it.
- `/routine snooze <name> [minutes]` — skip N minutes (default 60, max 10080).
- `/routine disable <name>` — disable the routine.
- `/routine enable <name>` — re-enable.

### Surface

Due routines appear as a `─ routines · N due ─` section in the belowEditor widget, with name, schedule summary, and status token (`due now`, `~5m`, `snoozed (30m)`, `disabled`). A due routine only ever shows a banner; it never runs itself and is never routed anywhere.

### Scheduler semantics

- **Interval:** `scheduleMs` (ms, clamped `[60000, 604800000]`).
- **at:** optional minutes-of-day (0–1439) for time-of-day pinning. When both `scheduleMs` and `at` are present, the first fire aligns to the next `at` minute; subsequent fires use the interval from that anchor.
- **Snooze:** skip until `snoozedUntil` passes.
- **Disable:** remove from the active list; re-enable restores it.
- **Concurrency:** single-flight per routine; a slow handler never overlaps.
- **Failure:** per-routine isolation; a broken routine never kills the scheduler.

A routine is surfaced only; it is never classified, routed, or auto-sent, and the routine system never spawns or sends on the subagent bridge by itself.

Routine definitions are stored in `settings.json` → `workflow.routines`. The scheduler starts at session start and stops on session shutdown (no leaked timers, INV-18). Settings changes via `/routine` refresh the scheduler without leaking timers.

Example settings block:

```json
{
  "workflow": {
    "routines": [
      {
        "name": "standup",
        "scheduleMs": 86400000,
        "at": [540],
        "prompt": "Summarize yesterday's work",
        "enabled": true
      }
    ]
  }
}
```

## Checks

```sh
npm install
npm run check
npm run format:check
npm test
```

The live provider/auth routes are intentionally not tested in CI. Run them only when the exact credentials and models are available.

Tests are proportional: prefer one focused production-seam check that proves related behavior. Add separate cases only for distinct high-risk boundaries; do not create a test per criterion by default.

## Concise output

The installer declares the Ponytail package and adds a local terse-output policy. Routine replies use concise, Caveman-style evidence; security warnings, irreversible action confirmations, and multi-step sequences are never compressed.
