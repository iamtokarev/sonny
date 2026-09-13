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

- `src/cli/main.ts` — command-line entrypoint; opens `ConfigStore`, then starts the `chat` or `gateway` command
- `src/cli/chat-loop.tsx` — interactive Ink UI, event subscription, command handling, 5-second config-poll interval
- `src/cli/gateway-command.ts` — `runGatewayCommand`: headless lifecycle for the channel gateway (SIGINT/SIGTERM)
- `src/runtime/create-agent-session.ts` — runtime composition root; defines the `AgentSessionBuilder` factory and wraps it in `ReloadableAgentSession`
- `src/runtime/agent-runtime.ts` — turn serialization, turn lifecycle events, and pre-turn/pre-compact config refresh
- `src/runtime/reloadable-agent-session.ts` — hot-reload wrapper implementing `ConfigurableAgentRuntimeSession`; advances snapshots or rebuilds the live runtime
- `src/runtime/runtime-config-signature.ts` — SHA-256 signature over runtime-affecting config fields (decides whether a reload rebuilds)
- `src/agent/agent-session.ts` — conversation engine
- `src/agent/session-state.ts` — mutable message state
- `src/domain/message.ts` — message, tool-call, and `ToolCompletionStatus` types

## Event system

- `src/events/runtime-event.ts` — event catalog (`RuntimeEvent` discriminated union, including `turn.cancelled`, `context.compaction.started`, `context.compaction.completed`, `config.reloaded`, `config.reload.failed`)
- `src/events/event-bus.ts` — `RuntimeEventBus` and `RuntimeEventPublisher` interfaces
- `src/events/in-memory-event-bus.ts` — synchronous in-process bus implementation
- `src/events/turn-context.ts` — `TurnContext` (with optional `AbortSignal`) and `RuntimeSource` types
- `src/events/publish-runtime-event.ts` — safe-publish helper
- `src/events/index.ts` — barrel exports

## TUI layer (Mulberry design system)

- `src/ui/theme.ts` — Mulberry color palette (rich/basic/monochrome tiers with auto-detection) and glyph definitions
- `src/ui/markdown.ts` — minimal markdown parser (headings, code, bullets, emphasis)
- `src/ui/text-input.ts` — pure reducer for the composer's editing model (cursor, word-delete, history navigation)
- `src/ui/key-router.ts` — central keystroke-to-intent dispatcher across four modes (idle, busy, approval, popup)
- `src/ui/tool-row.ts` — formats tool calls as one-line summaries; classifies `ToolCompletionStatus` into display status with per-tool result summarisation
- `src/ui/transcript.ts` — `TranscriptItem` model and `restoreTranscript()` for replaying history through the same renderers as live output
- `src/ui/ui-context.tsx` — React context threading `Theme` and `TerminalLayout` to all components
- `src/ui/context-meter.ts` — token usage model (percent, zones, 10-cell bar) shared by `/context` and the composer
- `src/ui/approval.ts` — builds `ApprovalModel` from `ToolApprovalRequest` (per-tool verbs, diff bodies, content previews)
- `src/ui/command-popup.ts` — slash-command filtering and closest-match logic
- `src/ui/use-terminal-size.ts` — hook for terminal columns/rows with narrow/wide breakpoints
- `src/ui/use-ticker.ts` — hooks for spinner animation and elapsed-seconds timer
- `src/ui/wrap.ts` — word-wrap and pad-to-width utilities
- `src/ui/components/transcript-view.tsx` — renders finished transcript items via Ink `<Static>` (scrollback, never redrawn)
- `src/ui/components/composer.tsx` — persistent input bar with cursor, placeholder, hint row, and state colors
- `src/ui/components/tool-row-view.tsx` — one-line tool call rendering with spinner while running
- `src/ui/components/approval-pane.tsx` — replaces composer row for tool approval prompts with diff-style display
- `src/ui/components/command-popup.tsx` — floating slash-command autocomplete
- `src/ui/components/context-meter.tsx` — visual token meter with `▰▱` cells
- `src/ui/components/answer.tsx` — renders assistant answers with markdown parsing
- `src/ui/components/user-turn.tsx` — full-width banded user message rendering
- `src/ui/components/notice.tsx` — info/warn/error notices below the conversation
- `src/ui/components/status-row.tsx` — "Working…" status with spinner and elapsed timer

## Tools and guardrails

- `src/tools/create-tool-registry.ts` — default capability registration
- `src/tools/tool-executor.ts` — approval, policy, execution, result transforms, tool event emission
- `src/tools/hooks/default-tool-hooks.ts` — default guardrails
- `src/tools/policies/*` — file and web destination policy checks
- `src/tools/builtin/*` — read/write/edit/bash/skill/web tools
- `src/cli/tool-display.ts` — formats `ToolCompletedEvent` for TUI display

## Context and history

- `src/context/context-manager.ts` — token estimation, compaction, and compaction event publishing
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

- `src/config/config-store.ts` — `ConfigStore` with revisioned frozen snapshots, source fingerprinting, and serialized refresh
- `src/config/config-diff.ts` — `diffConfigSections()` producing human-meaningful changed-section labels
- `src/config/config-error.ts` — `ConfigReloadError` and `toSafeConfigError()` (never exposes rejected secret values)
- `src/config/load-config.ts` — reads YAML config and a dotenv file, merging env overrides
- `src/config/parse-config.ts` — schema validation
- `src/config/schemas/*` — config schemas and defaults
- `src/config/index.ts` — barrel exports including `DEFAULT_CONFIG_PATH` and `DEFAULT_ENV_PATH`
- `src/llm/llm-provider.ts` — model provider abstraction

## Web integration

- `src/web/tavily-web-provider.ts` — Tavily adapter for both search and read
- `src/web/web-search-provider.ts` — search interface
- `src/web/web-read-provider.ts` — read interface

## Channels and gateway

- `src/channels/channel.ts` — core channel domain contracts (`ChannelSource`, `ChannelEvent`, `ChannelAdapter`, `ChannelOutput`, `toChannelTarget`)
- `src/channels/channel-gateway.ts` — `ChannelGateway`: runs adapters, serializes per-conversation turns, handles resets, drives delivery and approvals
- `src/channels/create-channel-gateway.ts` — composition root; builds adapters/delivery/approvals/bindings/sessions from one config snapshot and the access check
- `src/channels/channel-delivery.ts` — `ChannelDelivery`: routes `ChannelOutput` to the named adapter and rejects unknown channels
- `src/channels/channel-errors.ts` — `ChannelDeliveryError`
- `src/channels/channel-approval-broker.ts` — `ChannelApprovalBroker`: delivers approval prompts as inline buttons and resolves `allow`/`deny` callback actions
- `src/channels/channel-session-directory.ts` — `ChannelSessionDirectory`: live interactor cache plus persisted binding resume/replace/evict lifecycle
- `src/channels/channel-session-binding-store.ts` — atomic JSON persistence of conversation→session bindings and `createChannelSessionKey`
- `src/channels/channel-prompt.ts` — `buildChannelPrompt(source)`: channel-aware system-prompt context appended by `AgentSession`
- `src/channels/telegram/telegram-adapter.ts` — grammY-based `TelegramAdapter` (long-polling, inline keyboards, chunked delivery)
- `src/channels/telegram/telegram-text.ts` — `splitTelegramText`: bounded chunk splitting for the 4000-char message limit
- `src/conversation/session-interactor.ts` — `SessionInteractor`: shared serialized input→command/turn path used by both the TUI chat loop and the gateway
- `src/cli/gateway-command.ts` — `runGatewayCommand`: SIGINT/SIGTERM-handled lifecycle around `ChannelGateway.run`
- `src/commands/builtin/new-session-command.ts` — `/new` (`/reset`) channel-control command that triggers session replacement

## What to read first when changing something

- If the change affects user input or slash commands, start with `src/cli/chat-loop.tsx`, `src/ui/key-router.ts`, `src/commands/*` (including `src/commands/builtin/reload-command.ts` for the `/reload` command and `src/commands/builtin/new-session-command.ts` for `/new`).
- If the change affects messaging channels, the gateway, conversation bindings, or remote approval, start with `src/channels/channel-gateway.ts` and `src/channels/create-channel-gateway.ts` (see [channels and gateway](integrations/channels.md)).
- If the change affects config hot reload or the runtime config signature, start with `src/config/config-store.ts`, `src/runtime/reloadable-agent-session.ts`, `src/runtime/runtime-config-signature.ts`, and `src/runtime/agent-runtime.ts` (see [configuration and operations](operations/configuration.md)).
- If the change affects event types or the event bus, start with `src/events/*` and `src/runtime/agent-runtime.ts`.
- If the change affects TUI rendering, theming, or component layout, start with `src/ui/theme.ts`, `src/ui/components/*`, and `src/ui/transcript.ts`.
- If the change affects capabilities or safety, start with `src/tools/*`.
- If the change affects prompt size or long conversations, start with `src/context/*` and `src/history/*`.
- If the change affects startup or environment setup, start with `src/config/*` and `src/runtime/create-agent-session.ts`.
