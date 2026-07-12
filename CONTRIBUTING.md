# Contributing to KEEL

Thank you for considering a contribution. KEEL is implemented against a frozen architecture — that makes contributions *easier*, not harder: the boundaries are written down and machine-checked.

## Before you start

1. Read the [four laws](docs/architecture/00-overview.md#1-core-philosophy) and the [Engineering Constitution](docs/architecture/22-engineering-constitution.md).
2. Find the module you're touching in the [module contracts](docs/architecture/20-module-contracts.md) and the [dependency matrix](docs/architecture/21-dependency-rules.md).
3. Architectural changes (new dependency edges, new tools, schema changes) require an ADR in `docs/adr/` — open an issue first.

## Workflow

- Trunk-based: branch from `main` (`feat/<slug>`, `fix/<slug>`), PR back.
- Conventional Commits with the module as scope, e.g. `feat(shared): ...`.
- DCO sign-off required (`git commit -s`).
- `corepack pnpm verify` must pass locally before you push.
- Phase-closing PRs attach the [quality gates checklist](docs/architecture/25-quality-gates.md).

## What's most useful right now

Per the roadmap: fixtures, normalization rules for common output formats, and (from Phase 15) runner plugins built on `@keel/runner-sdk`.
