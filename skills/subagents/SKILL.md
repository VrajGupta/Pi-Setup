---
name: subagents
description: invoke this skill when the user asks you to use subagents
---

# Subagents

Each native subagent is headless, has its own context window, cannot see the parent conversation, cannot ask the user, and cannot spawn subagents or workflows. Give every child a self-contained prompt with paths, constraints, and the expected report.

A **stage parent** is different: it is a separately launched top-level chat/session
that runs one pipeline stage, such as `/part2` or `/part3`. It may coordinate its own
one-level child workers when that harness supports them. If a stage is launched via
`subagent_spawn` as a child of another session, it is not a stage parent and must
perform its work directly without nested dispatch. Use the GitHub Project item, the
GitHub issue, git, and the handoff as the durable bridge between separate stage-parent
sessions.

## Pi Harness

**Harness:** `pi`
**Prompt nicknames:** “pi”, “pi agent”, “pi subagent”
**Best default:** Use when the user does not request another harness. It inherits the parent model and thinking level when `model` or `reasoning_effort` is omitted.

For the Pi harness, do not use direct `anthropic/...` models even if they appear in
the model list; use the Claude Code harness for the Claude subscription, or an
explicit `openrouter/anthropic/...` route when OpenRouter is the intended provider.

Pi can use any model shown by `pi --list-models`. Prefer `provider/model-id`; a bare model id only works when unambiguous. Common picks in this environment:

| Model                            | Recommended effort |
| -------------------------------- | ------------------ |
| inherited parent model (default) | inherited          |
| `openai-codex/gpt-5.6-sol`       | `high`             |
| `openai-codex/gpt-5.6-terra`     | `high`             |
| `opencode/claude-fable-5`        | `medium`           |

**Thinking budgets:** `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. These map directly to pi thinking levels.

## Claude Code Harness

**Harness:** `claude`
**Prompt nicknames:** “claude”, “Claude Code”, “claude agent”, “claude subagent”, "cc"
**Best default:** use the latest fable model on high reasoning. Do not default to anything else, if the user does not specify, use fable.

| Model hint | Model               | Recommended effort |
| ---------- | ------------------- | ------------------ |
| `opus`     | Claude Opus alias   | `medium` for routine planning; `high` for ambiguous/high-risk planning |
| `fable`    | latest Claude Fable | `high`             |

**Thinking budgets:** `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. The extension maps these to Claude thinking-token budgets: 0, 1,024, 4,096, 10,000, 16,000, 32,000, and 63,999 tokens respectively.

Requires Claude Code to be installed and authenticated.

## Codex Harness

**Harness:** `codex`
**Prompt nicknames:** “codex”, “Codex CLI”, “codex agent”, “codex subagent”
**Best default:** `gpt-5.6-sol` with `high` effort for coding work. Do not use anything other than sol unless the user specifically asks for it.

| Model           | Recommended effort |
| --------------- | ------------------ |
| `gpt-5.6-sol`   | `high`             |
| `gpt-5.6-terra` | `high`             |
| `gpt-5.6-luna`  | `high`             |

**Thinking budgets accepted by the extension:** `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. Codex maps these to the nearest effort supported by the selected model; `off`/`minimal` become `minimal`, while `max` becomes the highest extension-supported Codex effort.

Requires the Codex CLI to be installed and authenticated.

## Spawn and Manage

Call `subagent_spawn` with a complete `prompt`, short `name`, chosen `harness`, and optional `working_dir`, `model`, and `reasoning_effort`. At most three native subagents run concurrently in this workflow. Keep pipeline
stages serial; a stage parent may use the allowance for clearly scoped helpers, not
for claiming multiple GitHub Project items.

- `subagent_check({ id })`: peek without blocking.
- `subagent_list()`: list all runs.
- `subagent_wait({ ids })`: block only when results are required to proceed.
- `subagent_cancel({ ids })`: stop runs while preserving partial transcripts.
- `/subagents`: inspect or take over a run interactively.

Results return automatically. After spawning, continue useful parent work instead of immediately waiting.

## Fleet stage-parent profile

Use this as the default model/harness map unless a project `CONTEXT` file overrides
it:

| Stage | Parent | Harness / model | Effort |
|---|---|---|---|
| `/part1` | Opus 5, dispatched by Luna or run visibly | Claude Code harness, `model: "opus"` | medium/high |
| `/part2` | Kimi K3 | Pi harness, `openrouter/moonshotai/kimi-k3` | high |
| `/part3` | GPT-5.6 Luna | Codex harness, `gpt-5.6-luna` | **max** |
| `/part4` | Grok 4.5 | Pi harness, `openrouter/x-ai/grok-4.5` | high/xhigh |

Kimi K2.7 Code helpers use the Pi harness and
`openrouter/moonshotai/kimi-k2.7-code` when the independent Kimi stage parent is
running. Do not route a Claude subscription through Pi: use the Claude Code harness.
If Luna dispatches Opus as a headless Claude child, provide the planning decisions
up front because the child cannot ask the user; use a visible Claude session for an
interactive `/part1` grill.
Do not confuse `codex/gpt-5.6-luna` with
`openrouter/openai/gpt-5.6-luna`; they are different auth routes.
