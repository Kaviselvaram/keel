# KEEL — Architecture Overview & Product Architecture

> Document 00 of the KEEL Architecture Blueprint.
> Status: FROZEN — Architecture v1.0 (2026-07-12) · Owner: Architecture · Last updated: 2026-07-12

---

## 1. Core Philosophy

KEEL is a **Local-First Regression Oracle for AI Coding Agents**. It answers exactly one question:

> **"Did this edit change behavior that the developer never intended to change?"**

Four laws govern every design decision in this blueprint. When a proposal conflicts with a law, the proposal loses.

| # | Law | Consequence |
|---|-----|-------------|
| L1 | **The runtime determines truth.** | Every verdict about *whether* behavior changed is computed by deterministic code from recorded executions. No LLM output ever flips a changed/unchanged bit. |
| L2 | **AI is on the non-critical path.** | The system must be fully functional — capture, replay, diff, report — with zero AI available. The classifier *annotates* facts (intended vs. collateral); it never *creates* them. Deleting the entire inference module must not break a single deterministic test. |
| L3 | **Local-first is an architectural property.** | No code path may open a socket to a non-loopback address except the user's declared local inference endpoint. This is enforced by module boundaries and tests, not by policy documents. |
| L4 | **Determinism before features.** | A feature that cannot produce byte-identical diff output for identical inputs does not ship. Nondeterminism is quarantined at capture time (normalization) — never patched over at diff time with fuzzy matching. |

### Why an "oracle" and not a test framework

Test frameworks require the developer to *predict* what matters and encode assertions. KEEL inverts this: it records **what the program actually does** and treats the recording as the specification. The developer's only job is to say "this current behavior is intended" (capture a baseline). Every subsequent divergence is a *fact* to be triaged, not a failure to be asserted. This is regression detection by **characterization**, not verification — closer to `git diff` for runtime behavior than to Jest.

This distinction drives the architecture: we never need semantics of "correct." We need **reproducibility** (replay), **comparability** (canonical forms), and **explainability** (classification). Those are the three engines.

---

## 2. Product Scope

**In scope:**

- Recording runtime behavior of developer-designated entry points ("probes") before an edit.
- Re-executing the same probes after an edit under identical, controlled conditions.
- Computing deterministic, structured divergences between recordings.
- Classifying each divergence as *intended*, *collateral*, or *uncertain* using a **local** LLM, given the code diff as context.
- Exposing this workflow to AI coding agents via **MCP** and to humans via **CLI**, with identical underlying semantics.
- Persisting baselines and reports locally with full replayability and provenance.

**Explicitly out of scope (non-goals):**

| Non-goal | Why |
|----------|-----|
| Proving correctness | KEEL compares behavior to *prior* behavior. If the baseline was wrong, KEEL faithfully preserves the wrongness. That is by design. |
| Replacing test suites | Tests encode intent for the future; KEEL detects unintended change in the present. Complementary, not competing. |
| AI code review (style, quality, bugs-at-rest) | Static opinions about code are a crowded market and violate L1 — they are not runtime facts. |
| Cloud sync, team dashboards, telemetry | Violates L3. If a team-sharing story ever exists, it is "commit the baseline directory to git," not a service. |
| Full-system deterministic replay (rr-style) | Research-grade complexity; the probe model gets 80% of the value at 5% of the cost. See ADR-006. |
| Generating fixes | KEEL reports and explains. Agents fix. Blending the two destroys trust in the oracle. |
| Mutation testing / coverage measurement | Different question ("are my tests good?") — not "did behavior change?" |

### Product boundary statement

KEEL's boundary is the **process boundary of the code under observation**, plus opt-in deep instrumentation per language. KEEL never modifies user source code on disk. KEEL never executes code the LLM produced. KEEL never phones home.

---

## 3. Success Metrics

Because KEEL is an oracle, its metrics are oracle metrics:

| Metric | Definition | Target (v1) |
|--------|-----------|-------------|
| **Determinism rate** | % of capture→immediate-replay runs (no code change) that produce zero divergences | ≥ 99.5% on supported runtimes |
| **True-regression recall** | % of injected behavioral regressions (benchmark suite) detected as divergences | ≥ 95% at process boundary |
| **Classification precision** | % of "collateral" labels that a human agrees with (curated eval set) | ≥ 80% (advisory quality bar) |
| **Time-to-verdict** | Wall-clock for `keel check` on the reference repo (50 probes) | ≤ 30s without LLM; ≤ 90s with |
| **Agent adoption friction** | Steps from `npm i -g` to first useful MCP verdict | ≤ 3 commands |
| **Zero-egress guarantee** | Network connections to non-loopback during full test matrix | 0, enforced in CI |

The determinism rate is the make-or-break metric. A regression oracle that cries wolf on flaky timestamps gets uninstalled within a day. It is the first thing the benchmark suite measures and the last thing allowed to regress.

---

## 4. Scope Ladder

### MVP (Phases 0–5 of the roadmap)

- **One capture mode:** process-boundary probes (command + args + stdin + env → exit code, stdout, stderr, fs effects).
- **One runner:** generic subprocess runner (any language) + Node-aware runner (deterministic clock/RNG via preload).
- **Diff engine v1:** canonical normalization + structural diff with typed divergences and ignore rules.
- **Storage v1:** SQLite metadata index + content-addressed object store.
- **CLI:** `keel init`, `keel capture`, `keel check`, `keel report`, `keel baseline ls/rm`.
- **No AI yet.** MVP proves the deterministic core alone is useful. (L2 made testable from day one.)

### v1 (feature-complete at Phase 9; v1.0 GA released at Phase 11 — see Doc 17)

- **MCP server** (stdio transport) with `keel_capture`, `keel_check`, `keel_status`, `keel_explain`.
- **Classification engine** with Ollama provider, heuristic fallback tier, and confidence model.
- **Network/filesystem interception** for the Node runner (record-mode + replay-mode stubbing).
- **Baseline invalidation & provenance** (git commit binding, environment fingerprint, config hash).
- **Watch mode** for interactive agent loops.

### Future roadmap (post-v1, unranked candidates — YAGNI applies)

- Deep instrumentation plugins: Python (`sys.monitoring`), then JVM/Go via language-owned adapters.
- Test-suite harvesting: derive probes from existing test invocations automatically.
- Input synthesis assisted by the local LLM (**generated inputs are still executed and recorded by the runtime — L1 preserved**).
- Baseline sharing via git (`.keel/` layout designed to be committable from day one, even if we don't advertise it).
- Editor surfaces (VS Code extension consuming the same core library).
- HTTP transport for MCP when the ecosystem settles.

Anything not on this list requires an ADR before it enters scope.

---

## 5. What I Changed From the Concept (Architect's Deviations)

The concept document (as described) implies things I am explicitly overruling. Recorded here so reviewers can push back:

1. **"Records runtime behavior" → probe-based capture.** Generic ambient recording of "the program" is undefined for a library, a server, and a CLI simultaneously. KEEL captures *named probes* — explicit, replayable invocations. Ambient/trace-based capture is a future plugin, not the foundation. (ADR-006)
2. **LLM classification is three-valued, not binary.** *intended / collateral / uncertain*. Forcing binary answers from a 7B local model manufactures false confidence, which is the one thing an oracle cannot afford. Divergences the model can't classify are surfaced as facts without labels — still useful under L1.
3. **A heuristic classifier tier sits in front of the LLM.** Cheap deterministic rules (e.g., "the diverging probe exercises the exact function the diff edited") classify the easy majority. The LLM sees only the residue. This makes AI even *more* non-critical and cuts latency. (Doc 07)
4. **SQLite stores metadata only.** Recordings are content-addressed files. (ADR-003, Doc 08)
5. **Verdicts are machine-first.** The primary consumer is an agent, not a human. Every output is a stable, versioned, structured document; human rendering is a projection of it — never the other way around.

---

## 6. Document Map

| Doc | Contents |
|-----|----------|
| 00 (this) | Philosophy, scope, metrics, deviations |
| 01 | Domain analysis |
| 02 | High-level design + system diagrams |
| 03 | Module design, LLD conventions, repository structure |
| 04 | Data model |
| 05 | Execution engine |
| 06 | Baseline + diff engines |
| 07 | AI classification engine |
| 08 | Storage design |
| 09 | MCP design |
| 10 | Configuration, logging, error handling |
| 11 | Security analysis |
| 12 | Performance analysis |
| 13 | Testing strategy |
| 14 | Open-source strategy |
| 15 | ADRs 001–010 |
| 16 | Risk analysis |
| 17 | Implementation roadmap (Phases 0–15) |
| 18 | Critical architecture review + readiness score (historical; findings applied at freeze) |
| 19 | Freeze record: consistency findings + resolved decisions |
| 20 | Module contracts (implementation contract) |
| 21 | Dependency rules (frozen matrix) |
| 22 | Engineering Constitution |
| 23 | Implementation standards |
| 24 | Implementation playbooks (Phases 0–15) |
| 25 | Quality gates |
| 26 | Final CTO review + certification |
| — | Architecture CHANGELOG · master index at [/ARCHITECTURE.md](../../ARCHITECTURE.md) |
