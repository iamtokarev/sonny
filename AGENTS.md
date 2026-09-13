# Agent guidance

- Use Bun for dependency management and runtime tasks.
- Keep changes focused and add or update tests for changed behavior.
- Before finishing, run the relevant checks: `bun run check`, `bun run typecheck`, and `bun run test`.
- Never commit credentials, local history, runtime logs, or generated runtime state.

## Agent skills

### Issue tracker

Local Markdown tickets are stored in `tickets/`, with supporting specifications in `specs/`. These files are not committed automatically. See `docs/agents/issue-tracker.md`.

### Domain docs

This repository uses a single-context domain-documentation layout. See `docs/agents/domain.md`.

<!-- OPENWIKI:START -->

## OpenWiki

See [AGENTS.md](AGENTS.md) for OpenWiki agent instructions.

<!-- OPENWIKI:END -->
time context, not required startup reading.

- Treat source code and tests as authoritative. A brief's unknowns and review items are verification gaps, not automatic requirements.
- Prefer the narrowest quiet validation that proves the changed behavior. Preserve complete failure output.

The scheduled OpenWiki GitHub Actions workflow refreshes the repository wiki. Do not hand-edit generated OpenWiki pages unless explicitly asked; prefer updating source code/docs and letting OpenWiki regenerate.

<!-- OPENWIKI:END -->
