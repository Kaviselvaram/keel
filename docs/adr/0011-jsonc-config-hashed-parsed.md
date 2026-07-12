# ADR-011: Configuration format — JSONC, hashed over canonical parsed form

> Status: Accepted · Frozen in Architecture v1.0 (2026-07-12) · Source: [Doc 15](../architecture/15-adrs.md)

**Context:** Config participates in baseline provenance; probes need inline documentation. **Decision:** `keel.config.jsonc` (plain `.json` also accepted). The behavior-affecting config hash is computed over the *canonicalized parsed document* — comments/whitespace never invalidate baselines. **Alternatives:** JSON (no comments — probe declarations are exactly where developers need to explain intent); TOML (fine format, but a second syntax for a JS-ecosystem audience and weaker schema/editor tooling); YAML (anchors/implicit-typing footguns are nondeterminism smells); JS/TS config (rejected already in Doc 10 — unhashable, executable). **Consequences:** one small JSONC parser dependency; editor autocomplete via published JSON Schema.
