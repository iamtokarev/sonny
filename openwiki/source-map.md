---
type: Source Map
title: Sonny source map
description: Practical guide to the main source directories and files that matter for runtime behavior, persistence, tools, context compaction, skills, configuration, and web integration.
tags: [source-map, navigation, reference]
resource: /src
---

# Sonny source map

This page is a navigation aid for the code paths that matter most in the first-pass wiki. Use the [architecture overview](architecture/overview.md) for runtime relationships, [context and history](data/context-and-history.md) for continuity behavior, [tools and guardrails](integrations/tools.md) for capability/safety work, and [configuration and operations](operations/configuration.md) for startup and verification setup.

## Runtime and CLI

- `src/cli/main.ts` — command-line entrypoint and startup wiring
- `src/cli/chat-loop.tsx` — interactive Ink UI and command handling
- `src/runtime/create-agent-session.ts` — runtime composition root
- `src/agent/agent-session.ts` — conversation engine
- `src/agent/session-state.ts` — mutable message state
- `src/domain/message.ts` — message and tool-call types

## Tools and guardrails

- `src/tools/create-tool-registry.ts` — default capability registration
- `src/tools/tool-executor.ts` — approval, policy, execution, result transforms
- `src/tools/hooks/default-tool-hooks.ts` — default guardrails
- `src/tools/policies/*` — file and web destination policy checks
- `src/tools/builtin/*` — read/write/edit/bash/skill/web tools

## Context and history

- `src/context/context-manager.ts` — token estimation and compaction
- `src/context/token-counter.ts` — token counting
- `src/context/llm-context-summarizer.ts` — LLM-backed summarization
- `src/history/history-store.ts` — JSONL session persistence
- `src/history/history-recorder.ts` — writes chat messages to history

## Skills and parsing

- `src/skills/load-skills.ts` — discovers workspace skills
- `src/skills/parse-skill.ts` — validates skill files
- `src/skills/build-skills-prompt.ts` — converts skills into prompt text
- `src/parsing/frontmatter.ts` — shared frontmatter parsing

## Configuration and LLM

- `src/config/load-config.ts` — reads YAML config and env overrides
- `src/config/parse-config.ts` — schema validation
- `src/config/schemas/*` — config schemas and defaults
- `src/llm/llm-provider.ts` — model provider abstraction

## Web integration

- `src/web/tavily-web-provider.ts` — Tavily adapter for both search and read
- `src/web/web-search-provider.ts` — search interface
- `src/web/web-read-provider.ts` — read interface

## What to read first when changing something

- If the change affects user input or slash commands, start with `src/cli/chat-loop.tsx` and `src/commands/*`.
- If the change affects capabilities or safety, start with `src/tools/*`.
- If the change affects prompt size or long conversations, start with `src/context/*` and `src/history/*`.
- If the change affects startup or environment setup, start with `src/config/*` and `src/runtime/create-agent-session.ts`.
