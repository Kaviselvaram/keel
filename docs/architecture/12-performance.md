# KEEL — Performance Analysis

> Document 12 · Status: FROZEN — Architecture v1.0 (2026-07-12)

## 1. Where the time actually goes

Expected cost order for `keel check`: **probe execution ≫ LLM classification ≫ storage I/O > diff > everything else.** Every optimization dollar goes to (a) executing fewer probes, (b) executing them concurrently, (c) bounding LLM time. Diff micro-optimization beyond hash short-circuiting is premature (L4 note: determinism constraints also *forbid* some optimizations, e.g. unordered parallel diff output — order is restored by sorting, cost accepted).

| Concern | Analysis | Design response |
|---------|----------|-----------------|
| **Probe execution** | dominated by user code + process spawn (~50–100ms/probe overhead; interpreter startup 100ms–2s) | bounded parallel execution (default `min(4, cores/2)` — probes may contend on shared fixtures, so parallelism is per-probe opt-out via `serial: true`); persistent warm runners (daemonized interpreter pools) are a *future* opt-in — they trade determinism risk (state bleed) for speed, so they're off the default path |
| **Replay skipping** | most edits touch code no probe exercises | Phase 12: probe→file dependency map (Node runner records module graph per execution at capture, cheap to collect) lets `keel check` replay only probes whose file closure intersects the git diff — the single biggest win available, and it's *sound* (over-approximate closure ⇒ never skips a probe that could diverge; falls back to full replay when the map is stale) |
| **LLM latency** | 1–10s per call on consumer hardware | heuristic tier first (majority resolved free), batching per probe, hard wall-clock budget, facts-first persistence means slow AI never delays the deterministic answer |
| **Memory** | large probe outputs | streamed to spill files with caps; diff operates on trees loaded per-probe, not whole-baseline; target steady-state < 200MB regardless of output size |
| **Disk** | baselines accumulate | CAS dedup (unchanged outputs stored once across baselines), zstd compression for objects >4KB, retention policy + explicit `keel gc`; `keel status` reports store size (observability of the cost) |
| **Large repositories** | repo size mostly irrelevant (KEEL touches declared probes, not the tree) — the exposure is many-probe configs (500+) | probe filtering (`--probe`, tags), dependency-map skipping, parallelism; per-probe timing in every verdict identifies the slow tail for the user |
| **SQLite** | trivially small workload (thousands of rows) | WAL + prepared statements; no tuning program beyond that (KISS) |

## 2. Performance as a tested property

`@keel/bench` runs in CI on the reference repo: time-to-verdict (50 probes, no-LLM) budget ≤30s, memory ceiling, determinism rate. Regressions fail the build — performance is governed by the same regression-oracle philosophy KEEL sells.
