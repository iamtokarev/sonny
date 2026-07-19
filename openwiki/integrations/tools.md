---
type: Integration Guide
title: Sonny tools and guardrails
description: Documents the tool registry, tool executor, built-in file and shell tools, skill loading, and web tools, including approval and policy hooks.
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

Tool calls pass through this sequence:

1. The model emits a tool call.
2. Pre-tool hooks inspect and possibly modify the request.
3. Policy hooks may deny unsafe calls or request user approval.
4. The user-facing approval hook can accept or reject the action.
5. The tool executes.
6. Post-tool hooks, failure hooks, and result-transform hooks run.
7. The result is emitted to the model and surfaced in the UI.

This layering keeps capability, safety, and presentation concerns separate.

## Guardrails

The default hooks include:

- file-access policy checks for `readFile`, `writeFile`, and `editFile`
- web URL destination policy checks for `webRead`
- ask-before-every-tool approval
- failure and denial logging
- result enrichment for recoverable failures
- output truncation at 20,000 characters

The file policy blocks dotenv basenames, selected sensitive files, known credential directories, and selected device paths; it resolves paths and follows existing symlinks but does **not** impose a general workspace-root boundary. `bash` is approval-gated but does not have a command allowlist or a workspace-only working-directory restriction in the current implementation. The executor returns a `BLOCKED:` payload that tells the model not to retry or bypass a denied action. These boundaries are intentionally important when extending the runtime and are surfaced by the [chat and command workflow](../workflows/chat-and-commands.md).

## Why this matters

The repository has grown from a simple chat loop into a local agent with filesystem, shell, skills, and web integration. The tool layer is the main extension point and the main safety boundary, so future changes should usually start here.

## Source anchors

- `src/tools/create-tool-registry.ts`
- `src/tools/tool-executor.ts`
- `src/tools/hooks/default-tool-hooks.ts`
- `src/tools/policies/file-access-policy.ts`
- `src/tools/policies/web-url-policy.ts`
- `src/tools/builtin/read-file-tool.ts`
- `src/tools/builtin/write-file-tool.ts`
- `src/tools/builtin/edit-file-tool.ts`
- `src/tools/builtin/bash-tool.ts`
- `src/tools/builtin/load-skill-tool.ts`
- `src/tools/builtin/web-search-tool.ts`
- `src/tools/builtin/web-read-tool.ts`
