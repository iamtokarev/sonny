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

Messages are stored with timestamps so resumed sessions preserve their conversation order and can be inspected later.

## Resume and continue

History supports three runtime modes:

- create a new session
- resume a session by ID
- continue the latest non-empty session

The runtime reads the persisted JSONL file back into memory when resuming or continuing. A resume reuses the system prompt stored in session metadata rather than rebuilding it from the current agent definition or skills catalog; this preserves old-session behavior but means prompt updates apply naturally to new sessions. Session selection begins in the [chat and command workflow](../workflows/chat-and-commands.md).

## Compaction

`src/context/context-manager.ts` estimates the full request (system prompt, messages, and tool schemas), compacts oversized unprotected tool results first, then summarizes the safely isolated middle of the conversation if the session still exceeds its threshold. The default configuration is a 200,000-token window at 75% (150,000 tokens), with four protected head messages and six protected tail messages.

The compaction strategy preserves the beginning and end of the conversation and only replaces the middle region when needed. This is important because the opening instructions and the most recent user context are usually the most valuable pieces of state.

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
