# ADR-014: Suppression lifecycle across re-capture

> Status: Accepted · Frozen in Architecture v1.0 (2026-07-12) · Source: [Doc 15](../architecture/15-adrs.md)

**Context:** Unresolved item #3 — what happens to a suppression when re-capture absorbs the accepted change? **Decision:** at baseline seal, active suppressions whose divergence no longer occurs transition to **`absorbed`** (inactive, retained for audit, counted in `keel status`); never silently deleted; optional expiry; an absorbed suppression cannot mask a future divergence at the same path. **Alternatives:** consume-and-delete (loses the audit trail of *why* behavior was accepted); keep-active-forever (silently masks future regressions at the same stableId — the dangerous option). **Consequences:** suppressions table gains a status column; `keel status` reports absorbed counts.
