# `replay/` — Replay Engine (Ring 1)

Contract: [Doc 20 §4](../../../../docs/architecture/20-module-contracts.md) · Policy: [ADR-012](../../../../docs/adr/0012-baseline-branch-worktree-semantics.md), [Doc 06 A4](../../../../docs/architecture/06-baseline-and-diff.md)

**Imports:** model, execution, shared, observability — **never** capture, diff, storage, config, adapters (CI rule `replay-forbidden-edges`). Normalization is reused via the `ReplayNormalizer` port (callers bind capture's `normalizeExecution` — Doc 20 §4 without the forbidden edge); documents arrive via `SnapshotSourcePort`. **Blind to outputs:** the single field read from a baseline snapshot document is `probeSpecHash` — comparison is diff's job, and replay structurally cannot peek.

Flow: validate sealed → per-field provenance policy (strict: configHash, ruleset, runtime major, os/arch, interceptors; warn: minor/ICU/gitCommit "ancestor-drift") → probe-set + spec-hash validation → hooks-wrapped replay-mode executions → normalize via port → fresh Snapshots. Hard mismatches return a **`stale-baseline` outcome** with every finding (never an error); warn findings ride along as facts. **Deliberate asymmetry with capture:** a main-execution timeout at replay is *data* (diff names it `probe-failed`) — capture defines intent, replay observes reality. Replay persists nothing; verdict assembly (next phase) owns that.
