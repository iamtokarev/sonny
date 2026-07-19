# Agent guidance

- Use Bun for dependency management and runtime tasks.
- Keep changes focused and add or update tests for changed behavior.
- Before finishing, run the relevant checks: `bun run check`, `bun run typecheck`, and `bun run test`.
- Never commit credentials, local history, runtime logs, or generated runtime state.

<!-- OPENWIKI:START -->

## OpenWiki

This repository uses OpenWiki for recurring code documentation. Start with `openwiki/quickstart.md`, then follow its links to architecture, workflows, domain concepts, operations, integrations, testing guidance, and source maps.

The OpenWiki GitHub Actions workflow refreshes the repository wiki after pushes to `main`. Do not hand-edit generated OpenWiki pages unless explicitly asked; prefer updating source code/docs and letting OpenWiki regenerate.

<!-- OPENWIKI:END -->
