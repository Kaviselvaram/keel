# ADR-004: Local AI only

> Status: Accepted · Frozen in Architecture v1.0 (2026-07-12) · Source: [Doc 15](../architecture/15-adrs.md)

**Context:** Classification needs an LLM; the product promise is privacy-as-architecture. **Decision:** inference restricted to loopback endpoints, enforced structurally in the provider layer and by the CI zero-egress test. No cloud provider option, ever, in core. **Alternatives:** optional cloud providers (one config flag away from betraying the core promise; forks can do it — core won't). **Consequences:** classification quality is capped by consumer-hardware models → this is *why* the architecture makes AI optional-and-additive rather than load-bearing (L2 is downstream of this ADR); the heuristic tier and eval corpus exist to compensate.
