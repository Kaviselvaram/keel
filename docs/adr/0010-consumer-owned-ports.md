# ADR-010: Interface-driven design with consumer-owned ports

> Status: Accepted · Frozen in Architecture v1.0 (2026-07-12) · Source: [Doc 15](../architecture/15-adrs.md)

**Context:** Long-lived OSS needs seams that survive contributor turnover. **Decision:** ports defined by consumers (DIP), implementations at the edges, manual composition roots, boundaries CI-enforced (dependency-cruiser), contract-test kits for every public port. **Alternatives:** DI container (unjustified weight); concrete coupling with refactor-later (never happens once plugins exist). **Consequences:** slight ceremony per port, paid deliberately at the four seams that matter (Runner, InferenceProvider, repositories, Logger) and *not* elsewhere — interfaces without second implementations or test needs are forbidden (YAGNI applied to abstraction itself).
