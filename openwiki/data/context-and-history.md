---
type: Data Model
title: Sonny context and history
description: Explains how Sonny stores JSONL conversation history, resumes sessions, and compacts long conversations while preserving important message boundaries.
tags: [data-model, history, context, persistence]
resource: /src/history/history-store.ts
---

# Sonny context and history

Sonny persists every chat session as JSONL and uses a context manager to keep active conversations within model limits.

## History storage

`src/history/history-store.ts` writes session metadata to an index file and messages to per-session JSONL files under the workspace `.history` directory.

A history session includes:

- session ID
- agent ID
- title
- message count
- creation and update timestamps
- the system prompt used for the session

Messages are stored with timestamps so resumed sessions preserve their conversation order and can be inspected later. Runtime events (`turn.started`, `tool.completed`, etc.) are observation-only and are never persisted to session state or JSONL — they flow through the event bus to subscribers and are discarded.

## Resume and continue

History supports three runtime modes:

- create a new session
- resume a session by ID
- continue the latest non-empty session

The runtime reads the persisted JSONL file back into memory when resuming or continuing. A resume reuses the system prompt stored in session metadata rather than rebuilding it from the current agent definition or skills catalog; this preserves old-session behavior but means prompt updates apply naturally to new sessions. Session selection begins in the [chat and command workflow](../workflows/chat-and-commands.md).

## Compaction

`src/context/context-manager.ts` estimates the full request (system prompt, messages, and tool schemas), compacts oversized unprotected tool results first, then summarizes the safely isolated middle of the conversation if the session still exceeds its threshold. The default configuration is a 200,000-token window at 75% (150,000 tokens), with four protected head messages and six protected tail messages.

### Token estimation and anchor calibration

The token counter (`src/context/token-counter.ts`) uses a rough 4-chars-per-token heuristic (`RoughTokenCounter`) rather than an exact tokenizer. This avoids the runtime cost of tokenizing every message and is sufficient for threshold-triggered compaction.

Because the rough estimate can diverge from the provider's real token count, the context manager calibrates it with actual usage data returned by the LLM provider (`TokenUsage.promptTokens`). After each model response, `AgentSession` calls `contextManager.recordUsage(response.usage)`, which stores the provider's prompt-token count alongside the rough estimate at that point (`roughAtAnchor`). Subsequent `inspect()` and `prepare()` calls return `effectiveTokens(rough)`:

- If no usage has been recorded yet, the rough estimate is used directly.
- Once anchored, the manager returns the real `anchorPromptTokens` as long as the rough estimate hasn't drifted beyond a tolerance (at least 4,096 tokens or 5% of the threshold, whichever is larger).
- If the rough estimate drifts beyond tolerance (meaning the conversation has grown significantly since the anchor), the manager falls back to the rough estimate to avoid under-reporting.
- After a successful compaction that changes messages, the anchor is cleared (`anchorPromptTokens = undefined`) so the next LLM response re-establishes it.

The compaction strategy preserves the beginning and end of the conversation and only replaces the middle region when needed. This is important because the opening instructions and the most recent user context are usually the most valuable pieces of state.

### Compaction events

Compaction is reported through the event bus so the TUI shows progress in real time rather than inferring it from timing or command results:

- **`context.compaction.started`** — published before the expensive summarization step. Carries `tokenCount`, `thresholdTokens`, and `forced` (`true` for manual `/compact`, `false` for threshold-triggered auto-compaction).
- **`context.compaction.completed`** — published after compaction finishes (or fails). Carries `tokenCountBefore`, `tokenCountAfter`, `compactedToolResultCount`, `summaryCompactedMessageCount`, `changed` (whether anything was modified), and `durationMs`.

Events are published through the `TurnContext` carried into `contextManager.prepare()`. If `compact()` throws, a "completed" event with `changed: false` is still emitted so no "started" event dangles. Manual `/compact` runs through `AgentRuntime.compactContext()`, which creates a synthetic `TurnContext` with a `system` source and enqueues through the same serialization queue as turns, preventing compaction from overlapping a running turn. See [architecture overview](../architecture/overview.md) for how these events flow through the bus to the TUI.

### What compaction preserves

- early session context that anchors the conversation
- late context that reflects the current task
- tool-call structure so the model can still reason about the workflow

### What compaction may rewrite

- large old tool outputs
- intermediate conversation messages
- persisted JSONL history when the in-memory state changes; replacement preserves timestamps for unchanged prefix/suffix messages and timestamps only new summary content at rewrite time

## Operational implications

Because history is the source of truth for resume/continue behavior, any change to compaction or history writing should be tested against:

- session replay
- latest-session discovery
- title generation from the first user message
- tool-call pairing after compaction

## Source anchors

- `src/history/history-store.ts`
- `src/history/history-recorder.ts`
- `src/context/context-manager.ts`
- `src/commands/builtin/context-command.ts`
- `src/commands/builtin/compact-command.ts`
