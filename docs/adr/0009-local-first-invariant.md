# ADR-009: Local-first as invariant

> Status: Accepted · Frozen in Architecture v1.0 (2026-07-12) · Source: [Doc 15](../architecture/15-adrs.md)

**Context:** Product identity. **Decision:** no non-loopback egress in any code path; no telemetry; no account; store lives in the repo. Enforced by module boundaries (only `inference/` opens sockets, loopback-validated) + CI zero-egress test. **Consequences:** no usage analytics → product decisions rely on issues/discussions and opt-in user reports via `keel doctor --bundle` (user-initiated, reviewed-before-send); team features must be git-mediated.
