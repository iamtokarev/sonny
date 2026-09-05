# Domain Docs

How engineering skills should consume this repository's domain documentation.

## Before exploring, read these

- `CONTEXT.md` at the repository root, when present.
- Relevant ADRs under `docs/adr/`, when present.

If these files do not exist, proceed silently. Domain documentation is created lazily when terminology or architectural decisions need to be recorded.

## File structure

This repository uses a single-context layout:

```text
/
├── CONTEXT.md
├── docs/adr/
└── src/
```

## Use the glossary's vocabulary

Use terminology defined in `CONTEXT.md` when naming tickets, proposals, tests, and domain concepts. If necessary terminology is absent, reconsider whether a new term is needed or record the gap for domain-modeling work.

## Flag ADR conflicts

Explicitly surface proposed work that conflicts with an existing ADR instead of silently overriding the decision.
