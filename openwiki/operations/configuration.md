---
type: Runbook
title: Sonny configuration and startup
description: Covers config loading, environment-variable overrides, workspace defaults, agent selection, and the OpenWiki update workflow used by the repository.
tags: [operations, configuration, startup, ci]
resource: /src/config/load-config.ts
---

# Sonny configuration and startup

Sonny loads YAML configuration, merges selected environment variables, and then wires that config into the runtime at startup.

## Configuration loading

- `src/config/load-config.ts` reads a YAML config file and merges environment overrides.
- `src/config/parse-config.ts` validates the result against the schema.
- `src/config/schemas/index.ts` defines the top-level shape.

The current config shape includes:

- workspace path
- LLM configuration
- default agent ID
- agents path
- context-compaction settings
- optional Tavily API key

## Environment overrides

The parser can override:

- `llm.apiKey` from `LLM_API_KEY`
- `tavilyApiKey` from `TAVILY_API_KEY`

`LLM_API_KEY` is required by the validated LLM schema; Tavily remains optional and only enables `webSearch` and `webRead` when present. Keep both values out of tracked YAML and do not commit local runtime state.

## Startup behavior

`src/config/index.ts` loads `src/config/config.yaml` at module import; `src/cli/main.ts` configures logging and starts the `chat` command. The runtime then uses the configured workspace for `.history` and `skills`, and the configured `agentsPath` plus `defaultAgent` to locate `AGENT.md`. The assembled dependencies and session-selection behavior are described in the [architecture overview](../architecture/overview.md).

## CI and documentation maintenance

`.github/workflows/ci.yml` verifies pull requests and pushes to `main` with a frozen Bun install, `bun run check`, `bun run typecheck`, and `bun run test`. See the [testing guide](../testing.md) for focused regression paths.

The repository also contains a scheduled/manual OpenWiki update workflow at `.github/workflows/openwiki-update.yml`. It installs the OpenWiki CLI, runs `openwiki code --update --print`, and opens a pull request covering `openwiki/`, `AGENTS.md`, `CLAUDE.md`, and the workflow file. Generated pages stay under `openwiki/`; keep runtime logs and workspace history out of git as required by `AGENTS.md`.

## Source anchors

- `src/config/load-config.ts`
- `src/config/parse-config.ts`
- `src/config/schemas/index.ts`
- `src/cli/main.ts`
- `.github/workflows/openwiki-update.yml`
