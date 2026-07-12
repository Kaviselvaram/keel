# KEEL — Implementation Playbooks (Phases 0–15)

> Document 24 · Status: FROZEN — Architecture v1.0 (2026-07-12)
> One playbook per roadmap phase (Doc 17). To keep playbooks executable rather than ceremonial, universal rules are stated once; each phase then lists only its specifics. Duration estimates assume one senior engineer full-time equivalent; complexity S/M/L/XL as in Doc 17.

## Universal Playbook Rules (apply to every phase)

- **Prerequisites:** all prior phases' exit criteria met; no open `IntegrityError`-class bugs.
- **Files forbidden to change, always:** sealed ADRs (append-only), Docs 00–23 of this blueprint (changes require a freeze amendment ADR), golden files and surface lockfiles without explicit review acknowledgment (C70/72), the dependency-cruiser ruleset except to *tighten* or to implement an approved ADR.
- **Architecture constraints:** Constitution (Doc 22) in full; module contracts (Doc 20); dependency matrix (Doc 21).
- **Security requirements:** zero-egress test green (from Phase 1 on); no new runtime dependency without review of maintenance status + install scripts; caps enforced on any new execution path.
- **Verification steps:** fast-lane CI + full matrix CI green; quality gates (Doc 25) checklist attached to the phase-closing PR.
- **Definition of Done:** deliverables merged; acceptance criteria demonstrated in CI or a recorded script; docs for the phase's surface updated; no TODOs referencing the phase remain.
- **Rollback strategy:** phases are additive and land as revertable PR stacks; store-schema-affecting phases (3, 8) must ship migration + tested backup-restore before the schema change merges; a phase is rolled back by reverting its stack — no phase may leave the store or public surfaces in a state a revert cannot undo.
- **Expected output:** a tagged pre-release (`0.<phase>.x`) exercised by the examples that exist at that point.

---

## Phase 0 — Foundations (S · ~1 week)
**Objective:** the skeleton that enforces the architecture before any engine exists.
**Scope/Deliverables:** 2-package pnpm workspace; strict tsconfig/eslint; dependency-cruiser rules encoding Doc 21 §1 in full; tiered CI (fast lane <5 min; matrix on merge); `shared/` (error hierarchy, ULIDs, Result, time port); Logger port + NDJSON sink skeleton; ADR files 001–016 seeded; release pipeline publishing a hello-world `keel --version`.
**Allowed paths:** everything (greenfield). **Acceptance:** a deliberate forbidden import fails CI (prove the gate); tag→npm publish with provenance works end-to-end. **Tests:** unit for shared/; CI self-test. **Future deps:** everything.

## Phase 1 — Behavior Model (M · ~2 weeks)
**Objective:** the frozen vocabulary and canonical form.
**Scope/Deliverables:** `model/` entities per Doc 04; canonical serializer; SHA-256 hashing; Merkle snapshot hashing; schema-version constants; golden serialization files; property suites (stability, order-insensitivity, NFC handling).
**Allowed:** `src/model/`, `tests/`. **Forbidden:** any other `src/` module.
**Acceptance:** canonical bytes byte-identical across the 3-OS matrix; property suites with large generator budgets green. **Performance:** hashing ≥100 MB/s on reference hardware (sanity bound). **Future deps:** all engines.

## Phase 2 — Execution Engine (L · ~4 weeks)
**Objective:** controlled subprocess execution on all tier-1 platforms.
**Scope/Deliverables:** `@keel/runner-sdk` types v0; `execution/` with command runner; shadow workdir; env allowlist; output/fs caps enforced live; **POSIX process groups + Windows Job Objects**; AbortSignal→kill within budget; streaming sink; fs-manifest observations; runner contract-test kit v0.
**Allowed:** `src/execution/`, `packages/runner-sdk/`, fixtures. **Forbidden:** `src/model/` (frozen post-P1 except additive Observation variants via mini-ADR).
**Acceptance:** contract kit green on 3 OS; runaway-output fixture truncated live with `output-limit` status; kill leaves zero orphans (verified by process-table assertion in tests). **Security:** env-allowlist test proves secret env var absent from child. **Future deps:** P4, P5, P7.

## Phase 3 — Storage (M · ~3 weeks)
**Objective:** durable, crash-safe local state.
**Scope/Deliverables:** SQLite schema v1 + migration runner + auto-backup; CAS with atomic rename + zstd; repository implementations + contract tests; advisory lock; `KEEL_STORE_DIR`; doctor integrity checks; GC skeleton.
**Allowed:** `src/storage/`, `src/config/` (store-location key only). **Acceptance:** crash-injection matrix (kill -9 at each pipeline stage) never yields visible partial state; migration round-trip with backup restore demonstrated. **Rollback note:** schema v1 is the baseline — no store predates it. **Future deps:** P4–P6.

## Phase 4 — Capture & Verification (L · ~4 weeks)
**Objective:** sealed, trustworthy baselines.
**Scope/Deliverables:** full `config/` (JSONC, hierarchy, schema, behavior-hash, project/user split); `capture/` pipeline; normalization ruleset v1 (volatile scrubbing, secret detectors, JSON sniffing); probe `hooks` (setup/teardown, hashed); verification replay (configurable count, default 2); environment fingerprint incl. ICU/locale data; seal/reject flow.
**Allowed:** `src/capture/`, `src/config/`, `src/services/` (CaptureService only), fixtures.
**Acceptance:** flaky fixture rejected naming the flapping path; secrets fixture scrubbed-and-flagged; determinism gate (capture→replay ×20, 3 OS) green on all fixtures. **Tests:** normalization idempotence property; config golden errors. **Future deps:** P5.

## Phase 5 — Replay, Diff, Verdict → **MVP** (L · ~5 weeks)
**Objective:** the deterministic oracle, end to end, no AI.
**Scope/Deliverables:** `replay/` (per-field provenance policy per ADR-012); pure `diff/` (full taxonomy, comparators, identity-keyed arrays, Merkle short-circuit, size ceiling); verdict assembly + facts persistence; tree-mutation detection (ADR-013); CheckService/ReportService; CLI (`init/capture/check/report/baseline ls|rm`); five-code exit contract; **dogfooding begins** (KEEL's own keel.config in repo, CI runs `keel check`).
**Allowed:** `src/replay/`, `src/diff/`, `src/services/`, `src/cli/`, fixtures, corpus.
**Acceptance:** reference repo (50 probes) check ≤30s; regression corpus v0 recall ≥90%; `diff(s,s)=[]` property green; stale-baseline and `ancestor-drift` paths demonstrated e2e; `tree-mutated` flag demonstrated. **Future deps:** everything user-facing.

## Phase 6 — MCP Server (M · ~3 weeks)
**Objective:** the agent surface.
**Scope/Deliverables:** `src/mcp/` stdio adapter; 5 tools with published JSON Schemas; diff-scoped `keel_check` default (path-prefix heuristic, `all:true` override); progress notifications; busy semantics; schema lockfile + golden tests; verdict-format reference doc; `examples/agent-loop/`.
**Allowed:** `src/mcp/`, `examples/`, `docs/guides/`. **Forbidden:** engines (an MCP need that requires engine change is a design smell — route through services).
**Acceptance:** full scripted session against a real MCP host on 3 OS; abort mid-check leaves no orphan processes; schema lockfile gate demonstrated. **Future deps:** P11, P14.

## Phase 7 — Node Deep Runner (L · ~5 weeks)
**Objective:** flagship-ecosystem determinism.
**Scope/Deliverables:** preload interceptors (virtual clock, seeded RNG opt-in, TZ/locale/NODE_ENV pinning; network record/stub); side-channel fd protocol; interceptor versioning in fingerprint; module-graph recording (feeds P12); tamper detection note in interceptor report.
**Allowed:** `src/execution/runners/node/`, runner-sdk (additive), fixtures.
**Acceptance:** fixture using `Date.now`+`Math.random`+`fetch` passes the determinism gate; `unrecorded-effect` divergence demonstrated; capability negotiation vs a P2-era baseline demonstrated (graceful `stale-baseline`). **Risk watch:** Node-internals churn (Risk #12) — interceptors use documented injection points only. **Future deps:** P12.

## Phase 8 — Heuristic Classification (M · ~3 weeks)
**Objective:** deterministic intent labels; the annotation machinery.
**Scope/Deliverables:** `classify/` skeleton with rule registry; initial rule set (edited-value overlap, untouched-file collateral, suppressed-stableId); annotations persistence (facts-first ordering); suppressions incl. `absorbed` lifecycle (ADR-014); `keel_suppress` + CLI equivalent; eval corpus v0 + labeling process (two-maintainer rule).
**Allowed:** `src/classify/` (no inference yet), `src/storage/` (annotations/suppressions migration), `src/services/`, corpus.
**Acceptance:** heuristic precision ≥95% on its claimed subset of the corpus; AI-deletable CI job introduced and green; absorbed-suppression flow demonstrated across a re-capture. **Future deps:** P9.

## Phase 9 — LLM Classification → **v1 feature-complete** (L · ~4 weeks)
**Objective:** the advisory tier, safely.
**Scope/Deliverables:** `inference/` port + Ollama provider (loopback-enforced at construction); evidence packets (hashed); versioned templates; budget, circuit breaker, full fallback ladder; confidence banding; default model per ADR-015 with hardware-floor detection; zero-egress CI test extended to cover inference paths.
**Allowed:** `src/inference/`, `src/classify/`, eval corpus.
**Acceptance:** classification precision ≥80% on corpus with the pinned default model; every fallback path visibly annotated in verdicts (demonstrated per ladder rung); check-with-LLM ≤90s budget on reference repo; non-loopback endpoint rejected with `UserError`. **Future deps:** P10.

## Phase 10 — Hardening & Platform Parity (M · ~3 weeks)
**Objective:** close the gaps before GA polish.
**Scope/Deliverables:** Windows encoding/path audit; second provider (llama.cpp-server) proving the port (zero classify-module changes allowed — that's the acceptance test of ADR-010); `doctor --bundle`; error-message audit vs Doc 10 C2 across every `UserError`.
**Acceptance:** provider swap diff touches only `src/inference/`; Windows determinism gate at parity with POSIX; doctor bundle contains no user code content (reviewed). **Future deps:** P11.

## Phase 11 — DX & Docs → **v1.0 GA** (M · ~4 weeks)
**Objective:** adoption.
**Scope/Deliverables:** `keel init` proposal flow; `keel_probe_propose` tool; guides ("writing good probes" is the flagship doc); scripted 90-second demo; examples CI-smoked; README with non-goals + hardware floor; GOVERNANCE.md; `tests/bench` → `@keel/bench` extraction; 1.0 gate review (determinism held a full cycle; store round-trip; three public contracts locked).
**Acceptance:** cold-start user (scripted) reaches first verdict ≤3 min on `examples/node-express-api`; 1.0 released with provenance. **Future deps:** P15.

## Phase 12 — Replay Skipping (L · ~4 weeks)
**Objective:** agent-loop latency.
**Scope/Deliverables:** probe→file dependency map from P7 module graphs; diff-intersection scheduling replacing the path-prefix heuristic; staleness detection with sound fallback to full replay.
**Acceptance:** soundness property test (never skips an affected probe — adversarial fixture set); touched-nothing edit costs ≈ hash comparisons; measured speedup published in bench. **Constraint:** over-approximation is mandatory; any precision improvement must prove soundness first. **Future deps:** P14.

## Phase 13 — Opt-in OS Sandboxing (L · ~5 weeks)
**Objective:** containment hardening without breaking local-first defaults.
**Scope/Deliverables:** sandbox-exec (macOS) / Landlock-or-nsjail (Linux) / AppContainer (Windows) as opt-in runner wrappers; docs updated to state exactly what is and isn't contained (C47).
**Acceptance:** sandboxed runs pass the full contract kit; default-path behavior byte-identical with sandbox off; network-deny demonstrated per platform. **Rollback:** feature-flagged; off = P12 behavior.

## Phase 14 — Watch Mode & Agent-Loop Ergonomics (M · ~3 weeks)
**Objective:** conversational-latency re-checks.
**Scope/Deliverables:** long-lived session mode (MCP + CLI watch); incremental re-check on change events; verdict deltas ("newly diverged since last check"); config hot-reload as new frozen snapshots.
**Acceptance:** single-probe change re-check <5s on reference repo (with P12); no state bleed across watch iterations (determinism gate run *in* watch mode). **Future deps:** —.

## Phase 15 — Ecosystem Opening (XL · ~6+ weeks)
**Objective:** third parties can extend KEEL safely.
**Scope/Deliverables:** runner-sdk 1.0 (contract frozen, kit complete incl. no-egress assertion); Python deep-runner reference plugin (separate repo/package, built only against the SDK); community contribution pipeline for normalization rules and heuristic rules; plugin trust documentation.
**Acceptance:** the Python plugin passes the kit **without any patch to the `keel` package** (the definitive test of the plugin boundary); first community rule merged through the documented pipeline. **Exit:** Architecture v1.0 fully realized; subsequent work requires v1.1 planning.
