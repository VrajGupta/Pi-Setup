# Vraj Pi

Personal Pi configuration for the planner → coder → debugger → reviewer workflow.

## What this owns

- `SYSTEM.md`: coordinator policy and stage protocol.
- `extensions/workflow`: risk-based routing, pinned stage launch, coordinator-mediated question relay, recovery state, and `/flow`/F6 command center.
- `extensions/ui-customization`: compact `π + project` header, permanent workflow rail, technical footer.
- `extensions/subagents`: the existing multi-harness engine plus the workflow bridge and safe `subagent_send` tool.
- `themes/vraj-ink.json`: OLED-black cyan/violet theme with semantic stage colors.
- `keybindings.json`: personal keybinding overrides.

Runtime state stays outside git: auth, sessions, trust, live settings, downloaded packages, environment files, and workflow checkpoints.

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
- **coder:** DeepSeek V4 Flash via OpenCodeGo subscription; when OpenRouter quota is reached, coding runs as Haiku 5 subagents orchestrated by Opus 5.
- **debugger:** OpenAI subscription (GPT-5.6 Luna); if the subscription has no usage or the limit is reached, use GPT-5.6 Luna via OpenRouter; if OpenRouter quota is also reached, use GPT-5.6 Luna via the OpenCodeGo subscription.
- **reviewer:** Grok 4.5 via OpenRouter; if the OpenRouter daily limit is reached, use Grok 4.5 via the OpenCodeGo subscription.

These match `STAGE_PROFILES` in `extensions/workflow/src/policy.ts`, which is the pinned source of truth.

A stage child cannot spawn children. It may return a validated `helper_request`; the Sol coordinator brokers sibling helpers and sends bounded results back.

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
