# Issue tracker: Local Markdown

Issues for this repository live as individual Markdown files in `tickets/`.
Supporting specifications live in `specs/`.

## Conventions

- Store one ticket per file under `tickets/`.
- Name tickets `<NN>-<slug>.md`, continuing the repository's existing sequence.
- Each ticket declares its title, user-facing outcome, blocking tickets, status, and acceptance criteria.
- Use `ready-for-agent` as the initial status for implementation-ready tickets.
- Record blocking relationships as ticket numbers and titles.
- Never combine several tickets into one file.
- Do not commit ticket or specification files unless the user explicitly requests it.

## When a skill says "publish to the issue tracker"

Create the corresponding individual Markdown files under `tickets/`.

## When a skill says "fetch the relevant ticket"

Read the referenced file from `tickets/`. The user may provide its path, number, or title.
