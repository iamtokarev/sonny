---
type: Testing Guide
title: Sonny testing guide
description: Summarizes the repository test and verification commands, and highlights the highest-value areas to test when changing runtime, tool, context, history, configuration, channels, or conversation code.
tags: [testing, verification, quality]
resource: /package.json
---

# Sonny testing guide

The repository uses Bun and TypeScript, with Biome for linting and formatting. The main verification commands are defined in `package.json`.

## Commands

- `bun test` — run the test suite
- `bun run typecheck` — TypeScript no-emit check
- `bun run lint` — lint the codebase
- `bun run check` — combined Biome check
- `bun run format` — write formatting changes

CI at `.github/workflows/ci.yml` runs `bun install --frozen-lockfile`, then `bun run check`, `bun run typecheck`, and `bun run test` on pull requests and pushes to `main`.

## High-value areas to test

When changing the runtime, focus on the following areas first:

- `src/runtime/*` — session assembly, `AgentRuntime` turn serialization, dependency wiring, `turn.cancelled` event reporting, and pre-turn/pre-compact config refresh via `ReloadableAgentSession`
- `src/config/*` — `ConfigStore` snapshot revisioning and fingerprint detection, `diffConfigSections()` labels, `loadConfig` env precedence, and `ConfigReloadError` safety (never expose rejected secrets)
- `src/events/*` — event bus dispatch, `publishRuntimeEvent()` safety, event type coverage including `context.compaction.started` / `context.compaction.completed` and `config.reloaded` / `config.reload.failed`
- `src/tools/*` — approval, policy, and execution behavior including event emission
- `src/context/*` — compaction, token counting, and compaction event publishing through `TurnContext`
- `src/history/*` — resume/continue and JSONL persistence
- `src/cli/*` and `src/commands/*` — command handling, TUI flow, event subscription, turn cancellation via `AbortSignal`, transcript restoration, the 5-second config-poll guard (`createConfigPollTick`), and the headless `gateway` command lifecycle
- `src/channels/*` — channel gateway lifecycle (adapter start/stop, fail-fast), per-conversation serialization, `/new` reset semantics, access checks, `ChannelApprovalBroker` timeout/cancel/delivery-failure, `ChannelSessionDirectory` resume/replace/evict, and `ChannelSessionBindingStore` atomic persistence
- `src/conversation/*` — `SessionInteractor` arrival-order serialization, command/turn/alias routing, source-bound context/compaction/reload, and aborted-input handling
- `src/ui/*` — pure-logic modules (theme, markdown, text-input, key-router, tool-row, transcript, context-meter), component rendering via `src/ui/test-support/ink-harness.tsx`, and tool outcome classification
- `src/llm/*` — signal passing as a request option and abort error re-throwing
- `src/web/*` — optional search/read provider behavior

## Good regression checks

A change that touches the conversation lifecycle should usually verify the relevant focused test files before the complete suite; architecture and lifecycle boundaries are mapped in the [architecture overview](architecture/overview.md), while policy work belongs to [tools and guardrails](integrations/tools.md).

A change that touches the conversation lifecycle should usually verify:

1. a new session can start
2. an existing session can resume
3. slash commands still short-circuit deterministically (including `/reload`, whose result is also reported by a `reload`-sourced event)
4. tool approval still blocks unsafe calls
5. `turn.started`, `turn.completed`, and `tool.completed` events fire for the correct `sessionId` and `turnId`
6. turn cancellation stops at the next checkpoint, records synthetic "denied" results for pending tool calls, and publishes `turn.cancelled` (not `turn.failed`)
7. compaction still preserves tool-call structure and publishes paired `context.compaction.started` / `context.compaction.completed` events even on failure
8. web tools still stay behind the Tavily configuration gate
9. config reload: an unchanged fingerprint yields `unchanged`; a semantic LLM change rebuilds the runtime and emits `config.reloaded` with `runtimeRebuilt: true`; a `sessionDefaults`-only change advances the revision without rebuilding (`runtimeRebuilt: false`); an invalid edit returns `rejected` retaining the last snapshot and emits `config.reload.failed`; a rejected apply is not retried until `force: true`; and the 5-second poll never stacks a second reload while one is in flight
10. channels: the gateway starts every adapter and stops them on abort; a transport failure fails fast and cancels pending approvals; per-conversation turns are serialized (queued messages do not overtake a running turn); `/new` interrupts active work, discards queued messages, replaces only the invoking binding, and confirms reset; unauthorized sources are rejected before session acquisition; a pending approval times out and is denied; gateway shutdown denies pending approvals; bindings persist atomically and survive a fresh directory; `SessionInteractor` preserves arrival order and skips aborted queued inputs

## Source anchors

- `package.json`
- `src/*/*.test.ts`
- `src/*/**/*.test.ts`
