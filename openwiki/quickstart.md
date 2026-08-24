---
type: Quickstart
title: Sonny OpenWiki quickstart
description: Entry point for the Sonny repository wiki. Explains the agent runtime, command flow, persistence, tools, context compaction, skills, web integration, and where to go next for deeper implementation details.
tags: [openwiki, quickstart, agent, cli, tools]
resource: /openwiki/quickstart.md
---

# Sonny OpenWiki quickstart

Sonny is a lightweight local-agent TypeScript project built around an interactive chat loop, deterministic slash commands, user-approved tool execution with guardrails, JSONL session persistence, context compaction, workspace-defined agent/skill prompts, optional Tavily web search/read capabilities, and config hot-reload so running sessions pick up edited configuration without restart.

Start here, then follow the linked pages for the major implementation areas:

- [Architecture overview](architecture/overview.md) — how the CLI, runtime, session state, and tool execution fit together.
- [Command and chat workflow](workflows/chat-and-commands.md) — how input moves from the TUI into the agent session and back.
- [Tools and guardrails](integrations/tools.md) — built-in file, shell, skill, and optional Tavily web tools plus approval/policy hooks.
- [Context and history](data/context-and-history.md) — persistence, resume/continue behavior, and compaction.
- [Configuration and operations](operations/configuration.md) — config loading, the `ConfigStore` hot-reload store, workspace layout, CI, and the OpenWiki refresh workflow.
- [Testing guide](testing.md) — verification commands, focused test areas, and regression checks.
- [Source map](source-map.md) — a practical guide to the key source directories and files.

## What this wiki covers

The repository has evolved from a basic chat loop into a local agent platform. Recent work added tools, skills, JSONL persistence, slash commands, compaction, and web tools; the latest changes rebuilt the TUI around a component-based Mulberry design system (`src/ui/`), added real turn cancellation via `AbortSignal`, and surfaced context compaction through the event bus, so the wiki focuses on those seams rather than every source file.

## How the runtime is organized

At a high level, `src/cli/main.ts` opens the `ConfigStore` and starts the `chat` command, `src/cli/chat-loop.tsx` renders the declarative Ink TUI (built on the Mulberry design system in `src/ui/`), subscribes to events, and runs a 5-second config-reload poll, `src/runtime/agent-runtime.ts` serializes turns and compaction and emits lifecycle events (including `turn.cancelled` for aborted turns and `config.reloaded` / `config.reload.failed` for reloads), `src/runtime/reloadable-agent-session.ts` wraps the live agent session so an edited config can rebuild the runtime in place, and `src/runtime/create-agent-session.ts` wires together config, skills, history, tool registry, hooks, the LLM provider, the context manager, and the event bus.

The central flow is:

1. The CLI resolves `chat --resume` or `chat --continue` options.
2. `createAgentSession()` loads or creates a history session, calls `configStore.refresh()` to seed a snapshot, defines an `AgentSessionBuilder` factory, wraps it in `ReloadableAgentSession`, and wraps that in `AgentRuntime`.
3. The chat loop accepts user text or slash commands.
4. Slash commands are handled deterministically before any model call.
5. Regular chat input goes through `AgentRuntime.runTurn()`, which creates a `TurnContext` (carrying an `AbortSignal` for cancellation), publishes `turn.started`, then refreshes configuration before delegating to `AgentSession.chat()`. The refresh may rebuild the live runtime (swapping LLM/tools/context manager) and emits `config.reloaded` or `config.reload.failed`.
6. Model tool calls are executed through `ToolExecutor`, which applies policy, approval, and result transforms, and publishes `tool.started` / `tool.completed` events.
7. History is persisted to JSONL and can later be resumed or compacted.

## Key concepts worth knowing first

- [Agent session](architecture/overview.md) — the object that bundles the system prompt, state, LLM, tools, history, and compaction; now wrapped in `ReloadableAgentSession` for hot-reload.
- [Tool registry and executor](integrations/tools.md) — where capabilities are registered and run.
- [Context compaction](data/context-and-history.md#compaction) — how long conversations stay within token limits.
- [Config hot-reload](operations/configuration.md) — how `ConfigStore` detects edits and `ReloadableAgentSession` rebuilds the running runtime.
- **Skills** — repository-local `workspace/skills/**/SKILL.md` files become a prompt catalog on new sessions and are loaded in full through `loadSkill`.
- **Web tools** — optional Tavily-backed search and page extraction are documented with the rest of the tool extension and safety boundary.

## Source anchors

If you want to jump straight into code, start with these files:

- `src/cli/main.ts`
- `src/cli/chat-loop.tsx`
- `src/runtime/agent-runtime.ts`
- `src/runtime/create-agent-session.ts`
- `src/runtime/reloadable-agent-session.ts`
- `src/runtime/runtime-config-signature.ts`
- `src/events/runtime-event.ts`
- `src/events/event-bus.ts`
- `src/tools/create-tool-registry.ts`
- `src/tools/tool-executor.ts`
- `src/context/context-manager.ts`
- `src/history/history-store.ts`
- `src/skills/load-skills.ts`
- `src/web/tavily-web-provider.ts`
- `src/config/config-store.ts`
- `src/config/load-config.ts`
- `src/commands/builtin/reload-command.ts`
- `src/ui/key-router.ts`
- `src/ui/tool-row.ts`
- `src/ui/transcript.ts`
- `.github/workflows/ci.yml`

## Task routing

| Change area or intent | Relevant wiki page | Source entry points | Important symbols or types | Focused tests | Minimal validation |
| --- | --- | --- | --- | --- | --- |
| Turn lifecycle / cancellation | [architecture overview](architecture/overview.md), [chat workflow](workflows/chat-and-commands.md) | `src/runtime/agent-runtime.ts`, `src/agent/agent-session.ts` | `AgentRuntime.runTurn`, `TurnContext.signal`, `turn.cancelled` | `agent-runtime.test.ts` ("reports an aborted turn as cancelled rather than failed") | `bun test src/runtime/agent-runtime.test.ts` |
| Config hot-reload | [configuration](operations/configuration.md), [architecture overview](architecture/overview.md) | `src/config/config-store.ts`, `src/runtime/reloadable-agent-session.ts`, `src/runtime/runtime-config-signature.ts` | `ConfigStore.refresh`, `ReloadableAgentSession.refreshConfiguration`, `RuntimeConfigurationResult`, `createRuntimeConfigSignature` | `config-store.test.ts`, `reloadable-agent-session.test.ts`, `runtime-config-signature.test.ts` | `bun test src/config/config-store.test.ts src/runtime/reloadable-agent-session.test.ts` |
| `/reload` command / TUI poll | [chat workflow](workflows/chat-and-commands.md) | `src/commands/builtin/reload-command.ts`, `src/cli/chat-loop.tsx` | `createReloadCommand`, `createConfigPollTick`, `describeConfigReloaded` | `reload-command.test.ts`, `chat-loop.test.ts` ("createConfigPollTick"), `chat-loop.ui.test.tsx` ("forces manual reload") | `bun test src/commands/builtin/reload-command.test.ts src/cli/chat-loop.test.ts` |
| Tool registry / guardrails | [tools and guardrails](integrations/tools.md) | `src/tools/create-tool-registry.ts`, `src/tools/tool-executor.ts` | `ToolExecutor.execute`, `ToolCompletionStatus` | `tool-executor` tests, `default-tool-hooks` tests | `bun test src/tools` |
| Context compaction | [context and history](data/context-and-history.md) | `src/context/context-manager.ts`, `src/context/token-counter.ts` | `ContextManager.prepare`, `context.compaction.*` events | context-manager tests | `bun test src/context` |
| Resume / continue | [chat workflow](workflows/chat-and-commands.md), [context and history](data/context-and-history.md) | `src/cli/main.ts`, `src/history/history-store.ts`, `src/runtime/create-agent-session.ts` | `resolveChatSessionSelection`, `CreateAgentSessionMode` | `create-agent-session.test.ts` (resume/continue) | `bun test src/runtime/create-agent-session.test.ts` |
| TUI rendering | [architecture overview](architecture/overview.md) | `src/ui/*`, `src/ui/components/*` | `routeKey`, `TranscriptItem`, `restoreTranscript` | `chat-loop.ui.test.tsx`, `ui/*` pure-logic tests | `bun test src/ui` |

## Backlog

- **Live-provider validation** — `src/llm/llm-provider.ts` and `src/web/tavily-web-provider.ts`; current coverage is primarily unit/mock based, so a real-provider acceptance guide is deferred.
- **Web V1 hardening** — `src/tools/policies/web-url-policy.ts`; DNS resolution, rebinding, and redirect validation are explicitly outside the present policy.
