# KEEL — Final CTO Review & Architecture Certification

> Document 26 · Status: FROZEN — Architecture v1.0 (2026-07-12)

## Part 1 — Final Independent Review (implementation begins tomorrow)

**Would I approve this architecture?** Yes. The design earns approval on one property above all: **its central promise is machine-enforced, not aspirational.** "The runtime determines truth" exists as CI jobs (AI-deletable build, zero-egress test, determinism gate, dependency matrix) rather than as slogans. Architectures fail when their principles live only in documents; this one compiles its principles.

**Would I change anything?** Two things I note without blocking. First, the diff-scoped default for `keel_check` (Phase 6) rests on a crude path heuristic for six phases until the real dependency map lands — I accept it because it is sound-by-over-approximation, but I direct that its false-full-replay rate be measured from dogfooding data starting Phase 6, so Phase 12 has evidence. Second, `keel init`'s proposal quality (Phase 11) carries more product risk than any engine: if proposals are poor, risk #2 (probe friction) materializes regardless of engineering quality. I direct that Phase 11 include a usability test with at least five cold users, not just the scripted 3-minute gate.

**Is anything over-engineered?** Candidly assessed: the 75-law Constitution and 26-document blueprint are heavy for a project with zero lines of code — but each machine-enforced law replaces a future review argument, and the deletion test was applied during freeze (rules without enforcement or review value were cut). The genuinely defensible over-engineering candidates — verification replay ×2, per-field fingerprint policy, three separately versioned public contracts — all sit directly under the product's single point of failure (trust), so they stay. What was *removed* as over-engineering: the third workspace package, DI containers, event buses, micro-packages, cross-process caches, background GC.

**Is anything under-engineered?** Three honest thin spots, all deliberate: (1) **stateful-dependency replay** (databases, queues) — hooks give a workable answer, not a great one; this is v2 territory and the scope docs say so; (2) **the command runner's determinism** rests heavily on normalization for non-Node languages until deep runners exist — acceptable because it's honestly reported via capabilities; (3) **Windows fs-manifest semantics** (junctions, case-insensitivity, AV interference) get one audit phase, and I expect it to find more than one phase's worth. Contingency: platform issues get priority over new features between P10 and GA.

**Biggest implementation risks?** (1) Phase 7 — Node interceptors touching runtime internals; the mitigation (documented injection points only, per-major CI lanes) is right but the estimate is optimistic; expect 5 weeks to become 7. (2) Phase 4 normalization ruleset quality — this is where determinism is won or lost; the fixture corpus must grow aggressively. (3) The e2e determinism gate flaking due to *CI infrastructure* nondeterminism (shared runners, clock skew) and eroding trust in the gate itself — invest in gate hygiene early.

**Biggest maintenance risks?** (1) Normalization rules and heuristic rules becoming an unreviewable pile — mitigated by data-driven registries with per-rule tests and attribution, but it needs a curator role; (2) interceptor chasing across Node majors (permanent tax, correctly priced in); (3) maintainer bandwidth vs. the CI surface — the tiered CI decision must be defended against gate creep on the fast lane.

**What becomes technical debt first?** The path-prefix diff-scoping heuristic (by design — Phase 12 retires it); the coarse LLM confidence bands (waiting on better local-model calibration); the golden CLI-output tests (chronic churn; contained by keeping human output a thin projection); `docs/guides` drift against generated references (mitigated by generating everything generable).

**What must absolutely never change?** The four laws (Doc 00 §1). Facts-before-annotations persistence ordering. The loopback-only inference constraint. Probe-based capture as the foundation (ADR-006). Immutability of sealed baselines and hashed content. The five-code exit contract. The rule that adapters contain no business logic. These are load-bearing walls; everything else is furniture.

## Part 2 — Certification Report

| Dimension | Score | Basis |
|-----------|-------|-------|
| Readiness | **93%** | zero unresolved architectural decisions; contracts, gates, playbooks in place; remaining 7% is irreducible pre-implementation uncertainty (P7 internals, P4 ruleset) |
| Maintainability | 90% | CI-enforced boundaries, contract tests, small dep tree; curator-role risk noted |
| Scalability (workload) | 85% | scales with probe count via parallelism + P12 skipping; single-machine by design, not a defect |
| Security | 88% | honest threat model, structural privacy enforcement, supply-chain posture; strong sandbox correctly deferred and correctly not overclaimed |
| Developer Experience | 84% | machine-first verdicts, error-message bar, 3-minute funnel; probe-authoring friction remains the watch item |
| Open Source Readiness | 90% | license/governance resolved, designed contribution surfaces, tiered CI, generated docs |
| Long-Term Maintainability | 87% | append-only stores, versioned everything, plugin boundary frozen behind a contract kit |
| Enterprise Readiness | 82% | Apache-2.0, no egress, provenance-attested releases; lacks (by design) central management — local-first |
| Risk posture | 85% | top risks (determinism, probe friction) have designed mitigations *and* measurement hooks |
| **Overall Grade** | **A− (89%)** | |

### Implementation Approval Status

## ✅ Approved For Implementation

Conditions of approval (directives, not blockers): measure diff-scoping false-full-replay from Phase 6; five-user cold-start test in Phase 11; platform-priority contingency between P10 and GA.

Signed: Chief Software Architect · Architecture v1.0 · 2026-07-12
