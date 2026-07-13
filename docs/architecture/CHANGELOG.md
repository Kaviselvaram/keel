# KEEL — Architecture Changelog

## v1.0 — FROZEN (2026-07-12)

### Stage 1: Initial draft (Docs 00–17)
Blueprint authored from the product vision. Major positions taken vs. the original concept, each with rationale recorded at the time:
- **Probe-based capture** replaced undefined "ambient behavior recording" (ADR-006) — makes replay well-defined and language-universal.
- **Three-valued classification** (`intended/collateral/uncertain`) replaced implied binary — honest confidence from small local models.
- **Heuristic tier before the LLM** — shrinks the AI surface; deterministic answers where possible.
- **Hybrid storage** (SQLite index + content-addressed store) replaced implied all-SQLite (ADR-003) — dedup, atomicity, inspectability.
- **Verification replay before baseline sealing** — converts flakiness into a capture-time diagnostic; trust over speed.
- **Machine-first verdicts** — agents are the primary consumer; human output is a projection.

### Stage 2: Five-persona self-review (Doc 18) — amendments adopted pre-freeze
| Change | Source & why |
|--------|--------------|
| Per-field fingerprint policy (`strict/warn/ignore`) + ICU/locale in fingerprint | Google-persona: version-strict fingerprints cause staleness fatigue while missing real `Intl` drift |
| Verification replay count configurable (default 2, CI 5) | Google-persona: one clean re-run is weak evidence |
| Diff-scoped `keel_check` default; `keel_probe_propose` tool | Cursor-persona: agent-loop latency; probe authoring was risk #2 with no agent surface |
| Probe `setup`/`teardown` hooks, hashed into probeSpecHash | Qodo-persona: stateful dependencies are the real determinism problem; probe schema retrofits are expensive |
| Windows Job Objects moved P10→P2; command-runner clock claim removed; `KEEL_STORE_DIR` | Microsoft-persona: kill semantics are foundational; half-capabilities are determinism lies; corporate sync/AV fights in-repo stores |
| Tiered CI; bench-as-folder until P11; two-maintainer corpus labeling | OSS-maintainer-persona: maintainer load is the realistic failure mode |
| Rejected: deferring the workspace split | runner-sdk types are needed across a real package boundary at P7; split is cheapest at P0 |

### Stage 3: Freeze (Docs 19–26 + in-place corrections)
**Consistency fixes** (full list: Doc 19 Part 1): exit-code contract unified to five codes (Doc 02↔10); package count corrected to two (Doc 03↔18); command-runner clock claim removed in place (Doc 05); Job Objects rescheduled in roadmap (Doc 17); verification-count and fingerprint-policy amendments written into Doc 06; probe hooks and suppression lifecycle written into Doc 04; store-location override into Docs 08/10; MCP surface updated (Doc 09); Persistence↔`storage/` naming mapping declared (Doc 01); version milestones unified (MVP=P5, feature-complete=P9, GA=P11).

**Decisions resolved** (full treatment: Doc 19 Part 2, ADRs 011–016): JSONC config hashed over parsed form (011); per-worktree stores + branch-label baseline resolution + `ancestor-drift` policy (012); `tree-mutated` verdict flag instead of tree snapshots (013); suppression `absorbed` lifecycle (014); ~7B coder-instruct default model + 8 GB floor (015); Apache-2.0 + DCO + two-maintainer rules (016).

**New at freeze:** module contracts (Doc 20), frozen dependency matrix (Doc 21), 75-law Engineering Constitution (Doc 22), implementation standards (Doc 23), per-phase playbooks (Doc 24), quality gates (Doc 25), certification (Doc 26), master index (/ARCHITECTURE.md).

**Post-freeze rule:** changes to Docs 00–25 require a freeze-amendment ADR; this changelog records every amendment.

## Post-freeze amendments

- **2026-07-13 · ADR-017 (Proposed):** Windows group-kill mechanism changed from Job Objects (Doc 05 §3, Doc 24 P2) to process-tree termination via `taskkill /T /F`. Raised during Phase 2: Job Objects require a native addon, conflicting with the frozen native-dependency budget (Doc 11 §7). The zero-orphans acceptance criterion is unchanged and CI-verified on all tier-1 platforms.
