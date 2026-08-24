---
type: Runbook
title: Sonny configuration and startup
description: Covers the ConfigStore-based config loading, environment-variable overrides, source-fingerprint reload detection, safe reload errors, and the OpenWiki update workflow used by the repository.
tags: [operations, configuration, startup, ci, reload]
resource: /src/config/config-store.ts
---

# Sonny configuration and startup

Sonny loads YAML configuration plus optional dotenv overrides into an immutable, revisioned `ConfigStore`, and wires that store into the runtime at startup so configuration can be refreshed without restarting the process. Hot reload is documented in the [architecture overview](../architecture/overview.md); this page covers the configuration side.

## Config store

`src/config/config-store.ts` owns the live configuration:

- `ConfigStore.open({ configPath, envPath })` loads, validates, deep-freezes the config, records a source fingerprint, and returns a store holding a revision-1 `ConfigSnapshot` (`{ revision, loadedAt, config }`). A load or validation failure is wrapped by `toSafeConfigError()` from `src/config/config-error.ts` into a `ConfigReloadError` that never surfaces raw config values.
- `store.current` returns the active `ConfigSnapshot`; `store.refresh({ force })` returns a discriminated `ConfigRefreshResult`:
  - `unchanged` — source fingerprint (mtimeNs:size) unchanged and/or semantic content identical; the snapshot and revision are retained.
  - `reloaded` — semantic change detected; `revision` increments, `changedSections` (from `diffConfigSections()`) report which logical areas moved.
  - `rejected` — reload failed (parse/validation/IO); the last valid snapshot is retained and a safe `ConfigReloadError` is returned, so the runtime keeps running.
- `refresh()` is serialized through an internal `refreshTail` promise chain, so concurrent refreshes collapse to a single reload.

`diffConfigSections()` in `src/config/config-diff.ts` reports human-meaningful sections: `llm`, `contextCompaction`, `web`, `sessionDefaults`. Only `sessionDefaults` (`workspace`, `agentsPath`, `defaultAgent`) are future-session defaults that do **not** require rebuilding the live runtime — the runtime layer uses `createRuntimeConfigSignature()` to make that distinction (see [architecture overview](../architecture/overview.md)).

## Configuration loading

- `src/config/load-config.ts` — `loadConfig(configPath, envPath?)` reads the YAML file and optional dotenv file in parallel and validates the merged result through `parseConfig()`. It is async and parses the dotenv file itself so it can detect edits to it.
- `src/config/parse-config.ts` — schema validation via `ConfigSchema`; applies env overrides before parsing.
- `src/config/schemas/index.ts` — top-level config shape.

The config shape includes:

- workspace path
- LLM configuration (`model`, `apiKey`, `temperature`, `maxTokens`, optional `reasoningEffort`)
- default agent ID and agents path
- context-compaction settings
- optional Tavily API key

## Environment overrides

Sonny resolves each key with `process.env` first, then the dotenv file, then YAML:

- `llm.apiKey` from `LLM_API_KEY`
- `tavilyApiKey` from `TAVILY_API_KEY`

Tavily remains optional and only enables `webSearch` and `webRead` when present. Keep both values out of tracked YAML and `.env` and never commit local runtime state.

`bunfig.toml` sets `env = false` so Bun does **not** auto-load `.env` into `process.env`; Sonny owns dotenv parsing so it can detect `.env` edits and keep `process.env` unmutated. `ConfigStore.open` uses `DEFAULT_CONFIG_PATH` (the bundled `src/config/config.yaml`) and `DEFAULT_ENV_PATH` (`$cwd/.env`), both exported from `src/config/index.ts`.

## Startup behavior

`src/cli/main.ts` defines `main()`, which opens the `ConfigStore` before parsing arguments, constructs the `Command` program with a `createProgram(configStore)` factory, and passes `configStore` (not a static `config`) to `createAgentSession`. Startup failures are caught centrally in `main().catch()` and surface as a non-zero `process.exitCode`. The runtime uses the configured workspace for `.history` and `skills`, and `agentsPath` plus `defaultAgent` to locate `AGENT.md`. Session assembly and reload behavior are described in the [architecture overview](../architecture/overview.md).

## CI and documentation maintenance

`.github/workflows/ci.yml` verifies pull requests and pushes to `main` with a frozen Bun install, `bun run check`, `bun run typecheck`, and `bun run test`. See the [testing guide](../testing.md) for focused regression paths.

Generated pages stay under `openwiki/`; keep runtime logs and workspace history out of git as required by `AGENTS.md`.

## Source anchors

- `src/config/config-store.ts`
- `src/config/config-diff.ts`
- `src/config/config-error.ts`
- `src/config/load-config.ts`
- `src/config/parse-config.ts`
- `src/config/index.ts`
- `bunfig.toml`
- `src/cli/main.ts`
