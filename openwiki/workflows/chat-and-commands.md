---
type: Workflow
title: Sonny chat and command workflow
description: Describes how the interactive TUI handles user input, slash commands, session selection, tool approvals, and resume/continue behavior.
tags: [workflow, cli, commands, chat]
resource: /src/cli/chat-loop.tsx
---

# Sonny chat and command workflow

The primary user experience is the `chat` command. Input is handled in two layers: deterministic slash commands first, then normal chat input through the agent session.

## Entry points

- `src/cli/main.ts` registers `chat`, `--resume <session-id>`, and `--continue`.
- `src/cli/chat-loop.tsx` renders the Ink UI and controls the message loop.
- `src/commands/create-command-registry.ts` wires the built-in slash commands.

## Input flow

1. The user submits text in the terminal UI.
2. The command registry checks whether the text is a slash command.
3. If it is a slash command, the registry returns a result intent such as `message`, `submit`, `alias`, or `exit`.
4. If it is not a slash command, the text is sent to the active agent session.
5. Tool calls requested by the model are surfaced in the UI and may require explicit approval.

## Slash commands

The built-in command set currently includes:

- `/help` and `/h` for command help
- `/context` for current context usage
- `/compact` for manual context compaction
- `/skills [query]` for listing loaded skills
- `/session` for session metadata

Slash-command output is treated as UI-only and is not written into LLM history. A bare `/` is ordinary chat input because it has no command name; unknown named commands produce a UI-only error.

## Resume and continue

The chat command supports two persistence-oriented modes:

- `--resume <session-id>` loads a specific session from history.
- `--continue` loads the latest non-empty session.

The TUI shows a resumed-session banner when applicable and displays a final reminder with the exact resume command on exit. Resume restores the persisted system prompt and message history; see [context and history](../data/context-and-history.md) for the on-disk model and compaction rewrite behavior.

## Tool approval in the UI

When the model wants to call a tool, the UI pauses for approval if the tool hooks request permission. The approval prompt is part of the interactive loop, not a separate batch workflow.

That design keeps high-risk operations explicit while still allowing the model to use tools for normal repository work.

## Source anchors

- `src/cli/main.ts`
- `src/cli/chat-loop.tsx`
- `src/commands/command.ts`
- `src/commands/command-registry.ts`
- `src/commands/create-command-registry.ts`
- `src/commands/builtin/*`
