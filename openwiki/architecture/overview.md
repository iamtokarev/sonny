---
type: Architecture Overview
title: Sonny architecture overview
description: Explains how the Sonny CLI, runtime composition, agent session, session state, LLM provider, context manager, history store, and tool executor fit together.
tags: [architecture, runtime, cli, agent]
resource: /src/runtime/create-agent-session.ts
---

# Sonny architecture overview

Sonny is centered on a single interactive agent runtime. The CLI starts a chat session, the runtime composes the dependencies needed for a conversation, and the agent session coordinates model requests, tool execution, persistence, and compaction.

## Main runtime pieces

- `src/cli/main.ts` defines the `chat` command and passes session-selection options into the runtime.
- `src/cli/chat-loop.tsx` owns the Ink TUI, slash-command dispatch, message rendering, and tool approval UI.
- `src/runtime/create-agent-session.ts` assembles the working set: config, skills, history, LLM provider, tool registry, tool hooks, and context manager.
- `src/agent/agent-session.ts` is the core conversation engine.
- `src/agent/session-state.ts` tracks the mutable message state for the active session.
- `src/history/history-store.ts` persists sessions and messages on disk.
- `src/tools/tool-executor.ts` enforces policy, approval, execution, and result transforms for tool calls.
- `src/context/context-manager.ts` estimates token usage and compacts history when needed.

## Runtime composition

`createAgentSession()` is the composition root. It loads skills, opens history under `<workspace>/.history`, selects a new/resumed/continued session, and then creates the LLM provider, default tool registry, approval/policy hooks, executor, token counter, summarizer, and context manager before constructing `AgentSession`. For a new session it loads `<workspace>/<agentsPath>/<defaultAgent>/AGENT.md`, builds a system prompt from agent instructions plus a skills catalog, and persists that prompt with the session; resumed sessions reuse the persisted prompt.

That choice matters because the runtime is intentionally assembled from small abstractions:

- the **LLM provider** is isolated in `src/llm/*`
- the **tool system** is isolated in `src/tools/*`
- the **context system** is isolated in `src/context/*`
- the **history system** is isolated in `src/history/*`
- the **skills system** is isolated in `src/skills/*`

## Conversation flow

1. The user types in the CLI.
2. The chat loop handles slash commands first.
3. Regular chat input is sent to `AgentSession.chat()`.
4. The session prepares a request using the current state and compaction rules.
5. The LLM may return tool calls.
6. Tool calls go through `ToolExecutor`, which can request permission, deny unsafe actions, or transform large outputs.
7. Successful messages are appended to history and can later be resumed.

## Workspace customization

The runtime loads an agent definition from `<workspace>/<agentsPath>/<defaultAgent>/AGENT.md`. On a new session, it combines that instruction body with a deduplicated skills catalog discovered from `<workspace>/skills/**/SKILL.md`; the catalog exposes only names and descriptions, while `loadSkill` retrieves a valid skill’s full body on demand. Invalid skill files are skipped with warnings, and a missing skills directory is non-fatal. Because a new session persists its completed system prompt, later agent-definition or skill-catalog edits do not retroactively change resumed sessions.

Use `src/agents/agents-loader.ts`, `src/skills/load-skills.ts`, `src/skills/parse-skill.ts`, `src/skills/build-skills-prompt.ts`, and `src/tools/builtin/load-skill-tool.ts` when changing this path. It depends on the startup defaults described in [configuration and operations](../operations/configuration.md) and feeds the persisted session model described in [context and history](../data/context-and-history.md).

## Why the architecture is split this way

The recent history shows a progression from a simple chat loop toward a local-agent platform: persistence, slash commands, and two-stage compaction arrived before the scaffolding refactor; the latest feature added provider-neutral web search/read abstractions backed by Tavily. The current structure keeps behavior changeable without making the CLI or runtime monolithic. For example, adding a capability or approval policy primarily touches [tools and guardrails](../integrations/tools.md) and runtime wiring, not the chat loop itself. Changes to request size or conversation continuity instead depend on [context and history](../data/context-and-history.md).

## Source anchors

- `src/runtime/create-agent-session.ts`
- `src/agent/agent-session.ts`
- `src/agent/session-state.ts`
- `src/history/history-store.ts`
- `src/tools/tool-executor.ts`
- `src/context/context-manager.ts`
- `src/cli/chat-loop.tsx`
- `src/cli/main.ts`
