# Phase 5 MVP Completion Report — Verdict, Check/Report, CLI, Dogfooding

> Commit: `278a06b` · Date: 2026-07-15 · CI: full matrix green incl. the dogfood gate on every platform
> Governing documents: Doc 20 §11/§13, Doc 24 P5, Doc 10 C2, ADR-012/013/014 · Prior slice: [PHASE_5_IMPLEMENTATION_REPORT.md](PHASE_5_IMPLEMENTATION_REPORT.md)

## 1. Executive Summary

**KEEL is a working regression oracle.** `keel capture` seals a verified baseline; an engineer (or agent) edits code; `keel check` replays, diffs, assembles a persisted Verdict, and exits with the frozen five-code contract. The proof is live in CI on every platform: KEEL dogfoods KEEL — capturing its own CLI surface, exit contract, and canonical serializer, then checking itself clean. Doc 24 Phase 5 is complete in full.

## 2. Architecture Compliance

Three prompt-vs-architecture conflicts were ruled on the record before code: **(a)** no "Verdict Engine" module exists in Architecture v1.0 — verdict assembly is CheckService's contract (Doc 20 §11), implemented there; **(b)** "severity calculation" was **declined** — it exists nowhere in the frozen design and would smuggle judgment into the deterministic core (L1); **(c)** suppression *creation* (`keel suppress`) stays Phase 8 per the playbook — evaluation, expiry, and absorb-on-seal are ADR-014-defined and shipped. Laws in structure: facts persist before check() returns (C11); every CLI output is a projection of a persisted document (C12 — `keel report` re-projection is dogfood-tested); tree mutation flags, never blocks (ADR-013); engine faults become persisted error verdicts, never silent subsets (Doc 03 §3.9); suppressions gate the *exit code* (their CI purpose) while facts stay untouched (Doc 04).

## 3–4. Verdict & CheckService Summary

CheckService: resolve baseline (explicit id or ADR-012 label resolution, defaulting to the git branch) → tree digest via consumer-owned port → replay (normalizer port bound to capture's ruleset) → per-probe diff with per-probe ignore rules → globally sorted divergences → `createVerdict` → persist → return. Warn-level provenance drift (ancestor-drift, ICU, runtime minor) lands in `verdict.staleness`; strict mismatches yield `stale-baseline` verdicts; replay snapshots persist with declared payload refs (GC-clean, e2e-asserted). Timing (`replayMs/diffMs/classifyMs=0/totalMs`) rides in the verdict per Doc 10 B.

## 5. ReportService Summary

`report(verdictOrId)` → the stable `CheckReport` document: verdict + per-divergence formatted path + suppression state + `unsuppressedCount`. Suppression matching (stable-id exact, pattern glob) is presentation-only; due expiries transition per ADR-014 at evaluation time. Deterministic by construction — the document is a pure function of persisted state; `--json` output is the canonical serialization.

## 6. CLI Summary

Exactly the frozen surface: `init`, `capture [--label|--probe…]`, `check [--baseline|--label|--json]`, `report <id> [--json]`, `baseline ls|rm`. Composition root owns all wiring (C27): config load, store open, NDJSON logs into the store, git provenance + ADR-013 tree digest (the recorded C23 composition-root ruling), SIGINT→AbortSignal. Exit contract: 0 clean (including all-suppressed diverged) · 1 diverged · 2 user/stale · 3 environment/error-verdict · 4 internal — e2e-asserted per code.

## 7. Regression Corpus Summary

[tests/regression-corpus/cases.json](../../tests/regression-corpus/cases.json): 11 cross-platform cases through the **real pipeline** (capture v1 → edit → check): leaf change, field add/remove, type change, identity-keyed reorder, exit-code change, hang→`probe-failed`, stderr text change; acceptable changes via timestamp normalization and ignore rules; plus a verdict-level property. C69's corpus now exists as the landing place for every future false positive/negative.

## 8. Dogfooding Summary

Committed [keel.config.jsonc](../../keel.config.jsonc) probes KEEL's own behavior — CLI help surface, the user-error exit contract, live canonical-serializer bytes — using env-*value* absolute paths (unhashed by design, so the config is portable). [scripts/dogfood.mjs](../../scripts/dogfood.mjs) walks check-without-baseline(2) → capture(0) → check(0) → report-re-projection(0) → baseline ls(0) and runs in CI's fast lane **and** all six matrix jobs. KEEL validates KEEL on every push.

## 9–10. Files

**Added:** services/[check-service.ts](../../packages/keel/src/services/check-service.ts), [report-service.ts](../../packages/keel/src/services/report-service.ts), [baseline-admin-service.ts](../../packages/keel/src/services/baseline-admin-service.ts), [probe-mapping.ts](../../packages/keel/src/services/probe-mapping.ts); cli/[git-provenance.ts](../../packages/keel/src/cli/git-provenance.ts), [render.ts](../../packages/keel/src/cli/render.ts); root keel.config.jsonc, scripts/dogfood.mjs, corpus + runner, check/report e2e, CLI e2e, this report. **Modified:** cli/args.ts (full parser) + main.ts (real composition root), capture-service (shared mapping + ADR-014 absorb-on-seal), services index (adapter-visible type re-exports), ci.yml (dogfood steps).

## 11–12. Dependency Compliance & Verification

depcruise: 0 violations across 132 modules / 587 edges — after it **caught a real violation in this slice's own code** (`render.ts` importing storage/capture types directly; fixed via service-seam re-exports, C26). All seven permanent gate injections still fire. Locally: lint 0 · typecheck clean · build clean · **246/246 tests** (34 files) · dogfood green.

## 13. GitHub CI Results

Run for `278a06b`: **success** — fast lane (with dogfood), 7-injection gate self-test, full matrix (3 OS × Node 22/24) each ending in CLI smoke + dogfood. `keel check` works end to end on every tier-1 platform.

## 14–15. Performance & Security Notes

Reference timing (dogfood, 3 probes, verification ×2): capture ≈ 3s, check ≈ 1s — comfortably inside the Doc 00 ≤30s budget; formal reference-repo benchmarking (50 probes) belongs to the P11 gate. Serial probe execution stands (parallelism is P12). Security: no new dependencies; git invocations are bounded (`5s` timeout, fixed args, no shell); suppression matching never interprets patterns as regex metacharacters beyond the frozen `*` glob; secrets posture unchanged.

## 16. Cross-platform Notes

The CLI e2e and dogfood gate run on all six matrix jobs — Windows-specific surfaces exercised: spawned CLI children, git porcelain digests, JSONC configs with Windows temp paths, exit-code propagation through `spawnSync`.

## 17. Known Limitations

(1) `keel init` writes a static scaffold; the repo-inspection proposal flow is P11 by design. (2) Suppressions can only be created programmatically until P8's `keel suppress`. (3) `codeDiffRef` is always null until classification needs it (P9). (4) Error verdicts are always `scope:'total'` — per-probe partial continuation is a refinement noted for P6's service polish. (5) The exit-code-gating-by-suppression decision is recorded here and in `main.ts`; if P6's MCP surface needs different semantics, that's the place to revisit — facts are unaffected either way.

## 18. Lessons Learned

The architecture gates are now catching *the architect's own* violations in real time (render.ts) — the enforcement investment from Phase 0 is paying compound interest. Dogfood probes taught a design lesson worth keeping: env-value indirection (names hashed, values not) is exactly the right mechanism for portable configs that need machine-local paths.

## 19. MVP Readiness Assessment

Every Doc 24 P5 exit criterion holds: `keel check` end to end ✓ · five-code contract ✓ · regression corpus recall 11/11 on its classes ✓ · `diff(s,s)=[]` property ✓ · stale-baseline and ancestor-drift paths demonstrated e2e ✓ · tree-mutated flag demonstrated ✓ · dogfooding in CI ✓. **The MVP milestone of the frozen roadmap is reached.** Next per Doc 24: Phase 6 (MCP server — the agent surface) with no architectural changes required.

## 20. Independent Engineering Audit

**Google:** CheckService's single try/catch converting engine faults into persisted error verdicts is the correct totality guarantee; flags per-probe partial verdicts as the next refinement (recorded, §17). **Microsoft:** exit-code semantics table is explicit and e2e-pinned per code — the thing CI consumers actually depend on; git acquisition is bounded and failure-tolerant. **HashiCorp:** the dogfood gate is the single most valuable CI addition since the determinism gate — a release that can't validate itself can't ship; suppression-gates-exit-code is the right CI ergonomics with facts preserved. **JetBrains:** CLI stays a true projection layer (parser and renderer are pure and separately tested); the service-seam type re-export pattern resolves the adapter-visibility question cleanly. **No blocking findings.**

**Phase 5 is complete. KEEL can validate KEEL.**
