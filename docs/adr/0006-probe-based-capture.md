# ADR-006: Probe-based capture, not ambient recording

> Status: Accepted · Frozen in Architecture v1.0 (2026-07-12) · Source: [Doc 15](../architecture/15-adrs.md)

**Context:** "Record runtime behavior" is undefined for arbitrary programs; full record/replay (rr-style) is research-grade and platform-hostile. **Decision:** behavior = the observed outputs of *named, declared, replayable invocations* (probes) at the process boundary, with per-language deep instrumentation as an additive capability. **Alternatives:** ambient tracing (unbounded scope, unreplayable without heroics); test-suite piggybacking only (inherits test flakiness and coverage gaps; still available later as a probe *source*); rr/Undo-style (Linux-only, perf, complexity). **Consequences:** the developer must declare probes — mitigated by `keel init` proposals; coarse granularity at first — mitigated by the Node deep runner; **this is the single decision most likely to be relitigated, hence sealed as an ADR.**
