---
type: Integration Guide
title: Sonny tools and guardrails
description: Documents the tool registry, tool executor, built-in file and shell tools, skill loading, web tools, and the approval hook injection point that lets the TUI and the channel gateway supply different permission strategies.
tags: [integrations, tools, safety, runtime]
resource: /src/tools/create-tool-registry.ts
---

# Sonny tools and guardrails

Sonny’s capabilities are delivered through a tool registry and executor. The registry decides which tools exist; the executor decides whether a tool call is allowed, how it is previewed, and how the result is transformed before it reaches the model or UI.

## Core pieces

- `src/tools/create-tool-registry.ts` registers the default tools.
- `src/tools/tool-registry.ts` stores and resolves tool definitions.
- `src/tools/tool-executor.ts` runs tool calls with policy, approval, and event hooks.
- `src/tools/hooks/default-tool-hooks.ts` installs the default guardrails.
- `src/tools/policies/*` defines the file and web URL policies.
- `src/tools/builtin/*` contains the built-in tools.

## Built-in tools

The default registry currently includes:

- `readFile`
- `writeFile`
- `editFile`
- `bash`
- `loadSkill` when skills are available
- `webSearch` and `webRead` when a Tavily provider is configured

## Tool execution model

Tool calls pass through this sequence, with events published at each boundary:

1. The model emits a tool call.
2. `ToolExecutor.execute(call, turnContext)` publishes `tool.started` (with tool name, parameters, and a preview string).
3. Pre-tool hooks inspect and possibly modify the request.
4. If `call.rawArguments` is set (meaning the model's arguments were not valid JSON), the executor short-circuits with an `invalid_arguments` failure, publishes `tool.completed`, and returns without executing the tool.
5. Policy hooks may deny unsafe calls or request user approval.
6. The user-facing approval hook can accept or reject the action.
7. The tool executes.
8. Post-tool hooks, failure hooks, and result-transform hooks run.
9. `tool.completed` is published (with status, content, `durationMs`, and an optional `approval: ToolApprovalOutcome` — `auto-approved`, `auto-denied`, `user-approved`, `user-denied`, or `policy-blocked`) via `publishRuntimeEvent()`.
10. The result is emitted to the model and surfaced in the UI.

Events are published through the `RuntimeEventPublisher` carried by `TurnContext`, which is created per-turn by `AgentRuntime`. The `ToolCompletedEvent.status` field uses `ToolCompletionStatus` — the same type stored on `ToolMessage` in session state — ensuring consistency between runtime events, UI display, and persisted history. The [architecture overview](../architecture/overview.md) shows how `TurnContext` flows from `AgentRuntime` through `AgentSession` to `ToolExecutor`.

## Guardrails

The default hooks include:

- file-access policy checks for `readFile`, `writeFile`, and `editFile`
- web URL destination policy checks for `webRead`
- ask-before-every-tool approval
- failure and denial logging
- result enrichment for recoverable failures
- output truncation at 20,000 characters

The file policy blocks dotenv basenames, selected sensitive files, known credential directories, and selected device paths; it resolves paths and follows existing symlinks but does **not** impose a general workspace-root boundary. `bash` is approval-gated but does not have a command allowlist or a workspace-only working-directory restriction in the current implementation. The executor returns a `BLOCKED:` payload that tells the model not to retry or bypass a denied action. Tool denial and tool-not-found also emit `tool.completed` events with `status: "denied"` or `status: "not_found"` respectively, so the UI is always notified. These boundaries are intentionally important when extending the runtime and are surfaced by the [chat and command workflow](../workflows/chat-and-commands.md).

### Approval hook injection

The approval layer has two modes selected by the `toolApproval.mode` config (`auto` by default), documented in full in [auto tool approval](../workflows/auto-tool-approval.md):

- **Auto mode** — `createDefaultToolHooks` builds an auto approval hook pair (`createAutoApprovalHooks`) that asks a pinned decision model (Jev via the OpenRouter Decisions API) a fixed set of true/false questions about the pending call, combines the probabilities against thresholds into an allow/deny/ask verdict, and lets the call run (`auto-approved`), auto-denies it with a recoverable message (`auto-denied`), or escalates to the user. The decision model is constructed in `createAgentSession` from `config.toolApproval`.
- **Manual mode** — every call that survives the file/URL policies asks the user; the decision model is never consulted.

In both modes the file and URL policies hard-deny first, then the approval pre-tool hook runs. The `PermissionHook` is not hard-wired: it is injected at session assembly in `src/runtime/create-agent-session.ts` via the `approveToolCall` option. The interactive TUI supplies a callback that renders the approval pane (`src/ui/approval-pane.tsx`) and waits for a keystroke; the channel gateway supplies `ChannelApprovalBroker.request`, which delivers the permission prompt to the messaging channel as inline buttons and resolves on a button callback (see [channels and gateway](channels.md)). Because the hook receives `ToolPermissionRequest` (including `turn.source`), an approval strategy can behave differently for `cli`, `channel`, and `system` sources — the broker denies non-channel requests without delivery. The auto approval hook also receives an `ApprovalContext` (recent user messages and the previous call) and the turn `AbortSignal` through `PreToolContext`.

## Why this matters

The repository has grown from a simple chat loop into a local agent with filesystem, shell, skills, and web integration. The tool layer is the main extension point and the main safety boundary, so future changes should usually start here.

The tool registry is constructed inside the runtime's `AgentSessionBuilder` factory (`src/runtime/create-agent-session.ts`), so it is rebuilt when a [config hot-reload](../operations/configuration.md) changes the runtime config signature — most importantly when `tavilyApiKey` is added or removed, which toggles `webSearch`/`webRead` availability on the live session.

## Source anchors

- `src/tools/create-tool-registry.ts`
- `src/tools/tool-executor.ts`
- `src/tools/hooks/default-tool-hooks.ts`
- `src/tools/approval/auto-approval-hook.ts`
- `src/tools/approval/decision-model.ts`
- `src/tools/approval/approval-questions.ts`
- `src/tools/approval/combine-approval-answers.ts`
- `src/tools/approval/cap-payload.ts`
- `src/agent/approval-context.ts`
- `src/tools/policies/file-access-policy.ts`
- `src/tools/policies/web-url-policy.ts`
- `src/tools/builtin/read-file-tool.ts`
- `src/tools/builtin/write-file-tool.ts`
- `src/tools/builtin/edit-file-tool.ts`
- `src/tools/builtin/bash-tool.ts`
- `src/tools/builtin/load-skill-tool.ts`
- `src/tools/builtin/web-search-tool.ts`
- `src/tools/builtin/web-read-tool.ts`
- `src/tools/tool-approval-description.ts`
