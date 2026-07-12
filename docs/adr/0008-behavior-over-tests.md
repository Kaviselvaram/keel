# ADR-008: Behavior over tests

> Status: Accepted · Frozen in Architecture v1.0 (2026-07-12) · Source: [Doc 15](../architecture/15-adrs.md)

**Context:** Why not "just run the test suite"? **Decision:** KEEL records characterized behavior of declared entry points rather than piggybacking assertions. **Rationale:** tests encode *predicted* intent and fail at exactly the unpredicted collateral changes KEEL targets; test suites are flaky (oracle poison) and their pass/fail bit is information-poor compared to structural divergences ("what exactly changed"). **Consequences:** KEEL complements rather than replaces tests; probe coverage is a new concept users must learn (the key DX risk, owned by docs + init).
