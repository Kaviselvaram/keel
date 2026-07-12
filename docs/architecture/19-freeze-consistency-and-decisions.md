# KEEL — Freeze Record: Consistency Review & Decision Resolutions

> Document 19 · Status: FROZEN — Architecture v1.0 (2026-07-12)
> This document records what the freeze review found and how it was resolved. All fixes have been applied in place to Docs 00–18. Nothing here is pending.

---

## Part 1 — Global Consistency Review Findings (Task 1)

Ten inconsistencies were found across the 19 draft documents. Each is resolved and the affected documents updated.

| # | Inconsistency | Documents in conflict | Resolution (applied) |
|---|---------------|----------------------|----------------------|
| 1 | Exit-code contract: Doc 02 said `stale/error=2` (3 codes); Doc 10 defined 5 codes | 02 vs 10 | Doc 10's five-code contract is canonical: 0 clean / 1 diverged / 2 user-actionable (incl. `stale-baseline`) / 3 environment / 4 internal. Doc 02 §3 updated. |
| 2 | Package count: Doc 03 declared three workspace packages incl. `@keel/bench`; Doc 18 review had accepted "bench as a folder until Phase 11" | 03, 17 vs 18 | Two packages at Phase 0 (`keel`, `@keel/runner-sdk`); benchmark harness lives at `tests/bench/`, extracted at Phase 11. Docs 03 §1–2, 17 P0/P11 updated. |
| 3 | Command-runner clock claim: Doc 05 implied libfaketime-style clock taming "where available"; Doc 18 platform review had removed the claim | 05 vs 18 | Clock/RNG interception is a deep-runner capability only; command runner honestly reports it absent. Doc 05 §1 updated. |
| 4 | Windows kill semantics: Doc 05/17 scheduled Job Objects at Phase 10; Doc 18 accepted moving them to Phase 2 | 05, 17 vs 18 | Job Objects in Phase 2 alongside POSIX process groups. Docs 05 §3, 17 P2/P10 updated. |
| 5 | Verification replay: Docs 02/06 described a single-shot verification; Doc 18 accepted a configurable count | 02, 06 vs 18 | Configurable verification count: default 2, CI-recommended 5. Doc 06 A1 updated (Doc 02 flowchart wording remains generically correct). |
| 6 | Probe schema lacked fixture hooks accepted in review | 04 vs 18 | `hooks` (setup/teardown, content-hashed into `probeSpecHash`) added to the Probe entity. Doc 04 updated. |
| 7 | Store location fixed in-repo; review accepted out-of-tree override | 08, 10 vs 18 | Default `<worktree-root>/.keel/`; `KEEL_STORE_DIR` override; path never hashed. Docs 08 §1, 10 A1 updated. |
| 8 | MCP surface missing review-adopted items (diff-scoped default, `keel_probe_propose`) | 09, 17 vs 18 | `keel_check` defaults to diff-scoped probes (sound over-approximation via path-prefix until P12); `keel_probe_propose` added at Phase 11, returns proposals only. Docs 09 §3, 17 P6/P11 updated. |
| 9 | Naming: domain "Persistence" (Doc 01) vs module `storage/` (Doc 03) with no declared mapping | 01 vs 03 | Mapping declared normatively in Doc 01 §2.8: Persistence = domain name, `storage/` = module name; all other synonyms forbidden vocabulary. |
| 10 | Version milestones: Doc 00 said "v1 (Phases 6–10)"; Doc 17 marks feature-complete at P9 and v1.0 GA at P11 | 00 vs 17 | Canonical: MVP = end of P5; v1 feature-complete = end of P9; v1.0 GA = end of P11. Doc 00 §4 updated. |

Verified clean at freeze (no action needed): ubiquitous-language terms (Probe/Snapshot/Baseline/Divergence/Verdict/Runner/Interceptor) are used identically in all 19 docs; all 9 Mermaid diagrams match their prose; the four laws L1–L4 are stated once (Doc 00) and referenced, never restated divergently; ADRs 001–010 match the frozen design; the Doc 03 repository tree matches the module list one-to-one; metrics in Docs 00/12/17 agree (≤30s no-LLM, ≤90s with, ≥99.5% determinism, ≥80% classification precision).

---

## Part 2 — Resolved Architectural Decisions (Task 2)

The six open items from Doc 18 §8, resolved. Full ADR treatment (context, options, trade-offs, consequences) is in Doc 15, ADRs 011–016; this table is the executive record.

| # | Problem | Chosen solution | ADR | Affected docs |
|---|---------|-----------------|-----|---------------|
| D1 | Branch/worktree baseline semantics | Store per worktree; baseline label defaults to branch; resolution = latest sealed baseline for current label; cross-label requires explicit id; per-field provenance policy (config `strict`, commit `warn`+`ancestor-drift`) | **ADR-012** | 04, 06, 08 |
| D2 | Working-tree mutation during a check | Tree digest at start, re-verified at verdict; mismatch flags verdict `tree-mutated` (facts kept, trust annotated); measure before paying for tree snapshots | **ADR-013** | 02, 04 |
| D3 | Suppression lifecycle across re-capture | `active → absorbed` on seal when the accepted change becomes baseline; retained for audit; never masks future divergences | **ADR-014** | 04, 08 |
| D4 | Config file format | JSONC; behavior hash over canonical *parsed* form (comments never invalidate baselines) | **ADR-011** | 10 |
| D5 | Default model + hardware floor | ~7B coder-instruct via Ollama (initially `qwen2.5-coder:7b-instruct`), model default is config data revisited per release; 8 GB RAM floor; auto-disable below with visible notice | **ADR-015** | 07, 00 |
| D6 | License & governance | Apache-2.0 + DCO; maintainer-led; GOVERNANCE.md at P11; two-maintainer rule for corpus labels and Constitution changes | **ADR-016** | 14 |

**Deliberately left open (impossible or wasteful to fix before implementation evidence exists):** exact heuristic-rule inventory for the Tier-1 classifier (grows from corpus data, Phase 8); the crude diff-scoping heuristic's precision threshold (tune against dogfooding data, Phase 6→12); llama.cpp-server request mapping details (Phase 10, behind a frozen port). These are *implementation* decisions inside frozen contracts, not architectural ones.

**Unresolved architectural decisions remaining: zero.**
