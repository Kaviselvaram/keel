# ADR-007: Subprocess execution

> Status: Accepted · Frozen in Architecture v1.0 (2026-07-12) · Source: [Doc 15](../architecture/15-adrs.md)

**Context:** How to run observed code. **Decision:** always out-of-process, process-group-managed subprocesses. **Alternatives:** in-process require/vm for Node (fast, but state bleed between runs destroys determinism, one crash kills KEEL, and it's Node-only — three fatal flaws); worker_threads (same isolation problems minus one). **Consequences:** ~100ms+ spawn overhead per probe (acceptable; parallelism + replay-skipping address it); uniform model across all languages; crash/timeout/cancel semantics are OS-level and therefore honest.
