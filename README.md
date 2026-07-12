# KEEL

**A local-first regression oracle for AI coding agents.**

KEEL answers exactly one question: *"Did this edit change behavior that the developer never intended to change?"*

It records runtime behavior before code changes, replays it after, computes deterministic structural differences, and asks a **local** LLM whether each change looks intentional or collateral. The runtime determines truth; the LLM only explains it.

- **No cloud. No telemetry. No remote inference.** Privacy is an architectural property, enforced in CI by a zero-egress test.
- **Not a test framework, not a correctness prover, not an AI code reviewer.** See [non-goals](docs/architecture/00-overview.md#2-product-scope).
- **AI is never the source of truth.** KEEL is fully functional with no model installed.

## Status

**Phase 0 — engineering foundation.** Architecture v1.0 is frozen and approved; engine phases land per the [roadmap](docs/architecture/17-roadmap.md). Nothing here is usable for regression checking yet.

Hardware note for later phases: local classification targets a ~7B model via Ollama and an 8 GB RAM floor; below that, KEEL runs with deterministic facts only.

## Architecture

Start at [ARCHITECTURE.md](ARCHITECTURE.md) — the master index for the frozen v1.0 blueprint (26 documents, 16 ADRs, engineering constitution, phase playbooks).

## Development

```
corepack pnpm install
corepack pnpm verify   # lint + dependency rules + typecheck + tests + build
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Module boundaries are CI-enforced; read the [Engineering Constitution](docs/architecture/22-engineering-constitution.md) before your first PR.

## License

[Apache-2.0](LICENSE)
