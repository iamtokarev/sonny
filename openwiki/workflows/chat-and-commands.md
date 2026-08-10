---
type: Workflow
title: Sonny chat and command workflow
description: Describes how the interactive TUI handles user input, slash commands, session selection, tool approvals, and resume/continue behavior.
tags: [workflow, cli, commands, chat]
resource: /src/cli/chat-loop.tsx
---

# Sonny chat and command workflow

The primary user experience is the `chat` command. Input is handled in two layers: deterministic slash commands first, then normal chat input through the agent session. The TUI is now a declarative React/Ink component tree (`src/ui/`) built around the Mulberry design system, with a centralized key router (`src/ui/key-router.ts`) that maps every keystroke to a `KeyIntent` across four modes (idle, busy, approval, popup).

## Entry points

- `src/cli/main.ts` registers `chat`, `--resume <session-id>`, and `--continue`.
- `src/cli/chat-loop.tsx` renders the Ink UI and controls the message loop.
- `src/commands/create-command-registry.ts` wires the built-in slash commands.

## Input flow

1. The user submits text in the terminal UI. The composer (`src/ui/components/composer.tsx`) manages editing state through a pure reducer (`src/ui/text-input.ts`).
2. A single `useInput` handler calls `routeKey({ mode, input, key, quitArmed })` from `src/ui/key-router.ts`, which returns a `KeyIntent` such as `submit`, `cancelTurn`, `approve`, `deny`, or `quit`.
3. The command registry checks whether the submitted text is a slash command.
4. If it is a slash command, the registry returns a result intent such as `message`, `submit`, `alias`, or `exit`.
5. If it is not a slash command, the text is sent to `AgentRuntime.runTurn()` with an `AbortSignal` from the UI, which creates a `TurnContext` and delegates to `AgentSession.chat()`.
6. Tool calls requested by the model are surfaced in the UI via event bus subscription — `tool.started` and `tool.completed` events update the display in real time. The runtime classifies each tool outcome with a `ToolCompletionStatus`, and the UI renders that classification rather than inferring status from content. Approval is still handled interactively when tool hooks request permission.

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

When the model wants to call a tool, the UI pauses for approval if the tool hooks request permission. The approval prompt is part of the interactive loop, not a separate batch workflow. After approval, `ToolExecutor` publishes `tool.started` and `tool.completed` events through the event bus; the chat loop subscribes (filtered by `sessionId`) and renders tool progress and results from those events rather than from direct return values.

That design keeps high-risk operations explicit while still allowing the model to use tools for normal repository work.

## Turn cancellation

When the user presses Escape (or otherwise triggers a `cancelTurn` intent), the UI calls `AbortController.abort()` on the signal passed to `AgentRuntime.runTurn()`. The signal propagates through `TurnContext` into `AgentSession.chat()` and down to `llm.chat()` as a request option, so in-flight HTTP requests are aborted rather than running to completion.

The agent session checks the signal at two checkpoints per iteration: before making an LLM call and before executing each tool. If aborted, it records synthetic "denied" tool results for any pending tool calls (using `recordCancelledToolCalls()`) so the conversation stays API-valid — without these, an assistant message would have tool calls with no matching results, which the OpenAI API rejects on the next request. `AgentRuntime` then publishes `turn.cancelled` (distinct from `turn.failed`) and re-throws the abort error unwrapped. The LLM provider intentionally does not wrap abort errors in `LLMProviderError` so the caller can distinguish cancellation from a real provider failure.

If a tool approval prompt is pending when cancellation fires, the UI auto-denies it with a `turnCancelledReason`, so the approval prompt does not block the cancellation. The TUI shows a "Turn cancelled" notice instead of an error.

See [architecture overview](../architecture/overview.md) for how `AbortSignal` flows through the runtime layers.

## Source anchors

- `src/cli/main.ts`
- `src/cli/chat-loop.tsx`
- `src/cli/tool-display.ts`
- `src/commands/command.ts`
- `src/commands/command-registry.ts`
- `src/commands/create-command-registry.ts`
- `src/commands/builtin/*`
- `src/runtime/agent-runtime.ts`
- `src/ui/key-router.ts`
- `src/ui/text-input.ts`
- `src/ui/components/composer.tsx`
- `src/ui/components/approval-pane.tsx`
