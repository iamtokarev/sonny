---
type: Quickstart
title: Sonny OpenWiki quickstart
description: Entry point for the Sonny repository wiki. Explains the agent runtime, command flow, persistence, tools, context compaction, skills, web integration, and where to go next for deeper implementation details.
tags: [openwiki, quickstart, agent, cli, tools]
resource: /openwiki/quickstart.md
---

# Sonny OpenWiki quickstart

Sonny is a lightweight local-agent TypeScript project built around an interactive chat loop, deterministic slash commands, user-approved tool execution with guardrails, JSONL session persistence, context compaction, workspace-defined agent/skill prompts, and optional Tavily web search/read capabilities.

Start here, then follow the linked pages for the major implementation areas:

- [Architecture overview](architecture/overview.md) — how the CLI, runtime, session state, and tool execution fit together.
- [Command and chat workflow](workflows/chat-and-commands.md) — how input moves from the TUI into the agent session and back.
- [Tools and guardrails](integrations/tools.md) — built-in file, shell, skill, and optional Tavily web tools plus approval/policy hooks.
- [Context and history](data/context-and-history.md) — persistence, resume/continue behavior, and compaction.
- [Configuration and operations](operations/configuration.md) — config loading, workspace layout, CI, and the OpenWiki refresh workflow.
- [Testing guide](testing.md) — verification commands, focused test areas, and regression checks.
- [Source map](source-map.md) — a practical guide to the key source directories and files.

## What this wiki covers

The repository has evolved from a basic chat loop into a local agent platform. Recent work added tools, skills, JSONL persistence, slash commands, compaction, and web tools, so the wiki focuses on those seams rather than every source file.

## How the runtime is organized

At a high level, `src/cli/main.ts` starts the `chat` command, `src/cli/chat-loop.tsx` renders the TUI, and `src/runtime/create-agent-session.ts` wires together config, skills, history, tool registry, hooks, the LLM provider, and the context manager.

The central flow is:

1. The CLI resolves `chat --resume` or `chat --continue` options.
2. `createAgentSession()` loads or creates a history session and assembles runtime dependencies.
3. The chat loop accepts user text or slash commands.
4. Slash commands are handled deterministically before any model call.
5. Model tool calls are executed through `ToolExecutor`, which applies policy, approval, and result transforms.
6. History is persisted to JSONL and can later be resumed or compacted.

## Key concepts worth knowing first

- [Agent session](architecture/overview.md) — the object that bundles the system prompt, state, LLM, tools, history, and compaction.
- [Tool registry and executor](integrations/tools.md) — where capabilities are registered and run.
- [Context compaction](data/context-and-history.md#compaction) — how long conversations stay within token limits.
- **Skills** — repository-local `workspace/skills/**/SKILL.md` files become a prompt catalog on new sessions and are loaded in full through `loadSkill`.
- **Web tools** — optional Tavily-backed search and page extraction are documented with the rest of the tool extension and safety boundary.

## Source anchors

If you want to jump straight into code, start with these files:

- `src/cli/main.ts`
- `src/cli/chat-loop.tsx`
- `src/runtime/create-agent-session.ts`
- `src/tools/create-tool-registry.ts`
- `src/tools/tool-executor.ts`
- `src/context/context-manager.ts`
- `src/history/history-store.ts`
- `src/skills/load-skills.ts`
- `src/web/tavily-web-provider.ts`
- `src/config/load-config.ts`
- `.github/workflows/ci.yml`

## Backlog

- **Live-provider and TUI validation** — `src/llm/llm-provider.ts`, `src/web/tavily-web-provider.ts`, and `src/cli/chat-loop.tsx`; current coverage is primarily unit/mock based, so a real-provider and terminal acceptance guide is deferred.
- **Web V1 hardening** — `src/tools/policies/web-url-policy.ts`; DNS resolution, rebinding, and redirect validation are explicitly outside the present policy.
