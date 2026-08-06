# Vraj Pi

Personal configuration for **Pi**, the terminal agent host this repo installs into
(`~/.pi/agent`). It turns a stock Pi into a four-stage delivery machine —
**planner → coder → debugger → reviewer** — driven from the prompt, the
belowEditor status surface, and a GitHub Projects board.

## What this repo is

Everything here gets linked (or copied) into `~/.pi/agent` by `./install.sh`:

- `SYSTEM.md` — coordinator policy: fleet protocol, stage boundaries, approved model map, invariants.
- `AGENTS.md` — agent rules for this repo: check/format/lint, type safety, test economy.
- `extensions/workflow` — risk-based routing, pinned stage launch, coordinator-mediated question relay, recovery state, `/mode`, `/flow`/F6 command center, `/routine` commands, the routines scheduler.
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

## Extending Pi

- **Commands** (`/mode`, `/flow`, `/routine`, …): `extensions/workflow/index.ts` — register with `registerCommand`.
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

## Workflow

Normal requests are classified automatically. Small reversible work stays direct. Risky or broad work is routed to the fleet. Routing mode is set by `workflow.mode` in `settings.example.json` (accepted values: `"workflow"`, the default, which auto-routes risky or broad work to the fleet; `"free"`, which routes everything direct unless an explicit `planner|coder|debugger|reviewer` or legacy `part1-4` stage is named). The explicit-stage override works in both modes; the mode changes routing only, never authz or data exposure. Vraj messages only the coordinator; the initial task goes to a stage through `workflow start`, and subsequent user or decision text reaches stages solely through the coordinator's explicit `workflow send` relay. Use `/flow` or **F6** for the command center.

Stage rows show elapsed time, completed assistant turns (`1t` = one turn), and measured context-window use (`<1% ctx`, for example). Context use is not task-completion progress; unavailable usage shows no percentage.

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

The primary status and control surface is the **belowEditor** widget — a live panel rendered below the prompt that shows the current routing mode, fleet route, active stage pipeline, per-agent progress, and active issue rows. The footer handles telemetry (cwd, runtime/model, usage, git/PR) and the workflow rail only; rich status lives below the prompt.

Mode labels are `mode free (manual)` (everything direct unless a stage is named) and `mode workflow` (auto-route risky or broad work to the fleet). Route labels are `route direct` and `route fleet/<stage>`. Use `/mode` to switch between `workflow` and `free (manual)` — bare `/mode` opens a native picker; partial input triggers completions; invalid input shows a warning, never an error. Use `/flow` or **F6** for the full command center (all tabs, full issue strings, capabilities, session details).

The current mode persists across restarts via `workflow.mode` in settings. The tracker poll interval (`workflow.trackerPollMs`, default 10000) and the surface runaway ceiling (`workflow.statusWidget.maxLines`, default 40) are configurable in `settings.example.json`.

## Routines

Periodic scheduled prompts (like Claude Code routines) are configured under `workflow.routines` in settings. Each routine has a name, a prompt/task template, and a schedule (fixed interval in ms, with optional `at` minutes-of-day for time-of-day pinning). The scheduler is single-flight per routine and runs off the render path (INV-10, INV-13).

### Commands

- `/routine` — bare picker of available (enabled, not snoozed) routines.
- `/routine run <name>` — classify the routine's prompt and execute it.
- `/routine snooze <name> [minutes]` — skip N minutes (default 60, max 10080).
- `/routine disable <name>` — disable the routine.
- `/routine enable <name>` — re-enable.

### Surface

Due routines appear as a `─ routines · N due ─` section in the belowEditor widget, with name, schedule summary, and status token (`due now`, `~5m`, `snoozed (30m)`, `disabled`). The `/flow` Routines tab shows the full list with prompt previews.

### Scheduler semantics

- **Interval:** `scheduleMs` (ms, clamped `[60000, 604800000]`).
- **at:** optional minutes-of-day (0–1439) for time-of-day pinning. When both `scheduleMs` and `at` are present, the first fire aligns to the next `at` minute; subsequent fires use the interval from that anchor.
- **Snooze:** skip until `snoozedUntil` passes.
- **Disable:** remove from the active list; re-enable restores it.
- **Concurrency:** single-flight per routine; a slow handler never overlaps.
- **Failure:** per-routine isolation; a broken routine never kills the scheduler.

Routine prompts route through `classifyRequest` with the current routing mode (INV-8); the routine system never spawns or sends on the subagent bridge by itself.

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
