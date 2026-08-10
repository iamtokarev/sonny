---
type: Testing Guide
title: Sonny testing guide
description: Summarizes the repository test and verification commands, and highlights the highest-value areas to test when changing runtime, tool, context, history, or configuration code.
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

- `src/runtime/*` — session assembly, `AgentRuntime` turn serialization, dependency wiring, and `turn.cancelled` event reporting
- `src/events/*` — event bus dispatch, `publishRuntimeEvent()` safety, event type coverage including `context.compaction.started` / `context.compaction.completed`
- `src/tools/*` — approval, policy, and execution behavior including event emission
- `src/context/*` — compaction, token counting, and compaction event publishing through `TurnContext`
- `src/history/*` — resume/continue and JSONL persistence
- `src/cli/*` and `src/commands/*` — command handling, TUI flow, event subscription, turn cancellation via `AbortSignal`, and transcript restoration
- `src/ui/*` — pure-logic modules (theme, markdown, text-input, key-router, tool-row, transcript, context-meter), component rendering via `src/ui/test-support/ink-harness.tsx`, and tool outcome classification
- `src/llm/*` — signal passing as a request option and abort error re-throwing
- `src/config/*` — schema parsing and environment overrides
- `src/web/*` — optional search/read provider behavior

## Good regression checks

A change that touches the conversation lifecycle should usually verify the relevant focused test files before the complete suite; architecture and lifecycle boundaries are mapped in the [architecture overview](architecture/overview.md), while policy work belongs to [tools and guardrails](integrations/tools.md).

A change that touches the conversation lifecycle should usually verify:

1. a new session can start
2. an existing session can resume
3. slash commands still short-circuit deterministically
4. tool approval still blocks unsafe calls
5. `turn.started`, `turn.completed`, and `tool.completed` events fire for the correct `sessionId` and `turnId`
6. turn cancellation stops at the next checkpoint, records synthetic "denied" results for pending tool calls, and publishes `turn.cancelled` (not `turn.failed`)
7. compaction still preserves tool-call structure and publishes paired `context.compaction.started` / `context.compaction.completed` events even on failure
8. web tools still stay behind the Tavily configuration gate

## Source anchors

- `package.json`
- `src/*/*.test.ts`
- `src/*/**/*.test.ts`
