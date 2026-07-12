# KEEL — Architecture v1.0 (Master Index)

> **Status: FROZEN — Architecture v1.0 · 2026-07-12 · ✅ Approved for implementation**
> This is the landing page for contributors. Every implementation phase references this blueprint; new architectural decisions require an ADR (see [standards](docs/architecture/23-implementation-standards.md)). Start with the [four laws](docs/architecture/00-overview.md#1-core-philosophy) and the [Engineering Constitution](docs/architecture/22-engineering-constitution.md).

**KEEL** is a Local-First Regression Oracle for AI Coding Agents. It answers one question: *"Did this edit change behavior that the developer never intended to change?"* The runtime determines truth; a local LLM only explains it; nothing leaves the machine.

## The Blueprint

| # | Document | What it governs |
|---|----------|-----------------|
| 00 | [Overview & Product Architecture](docs/architecture/00-overview.md) | The four laws, scope, non-goals, success metrics, MVP/v1 ladder |
| 01 | [Domain Analysis](docs/architecture/01-domain-analysis.md) | Ubiquitous language, 11 domains, 4 rings, principle mapping |
| 02 | [High-Level Design](docs/architecture/02-high-level-design.md) | Components, request/response lifecycle, all system diagrams |
| 03 | [Modules & Repository](docs/architecture/03-modules-and-repo.md) | Packaging (2-package workspace), repo tree, module design, LLD conventions |
| 04 | [Data Model](docs/architecture/04-data-model.md) | Every entity, relationships, lifecycle, ownership |
| 05 | [Execution Engine](docs/architecture/05-execution-engine.md) | Runner port, interceptors, sandbox, cancellation, language strategy |
| 06 | [Baseline & Diff Engines](docs/architecture/06-baseline-and-diff.md) | Capture lifecycle, verification replay, normalization, divergence taxonomy |
| 07 | [AI Classification](docs/architecture/07-classification.md) | Two-tier classifier, provider abstraction, fallback ladder, confidence |
| 08 | [Storage](docs/architecture/08-storage.md) | SQLite + CAS hybrid, schema, repositories, migrations, GC |
| 09 | [MCP Design](docs/architecture/09-mcp-design.md) | Tool surface, transport, error model, versioning |
| 10 | [Config, Logging, Errors](docs/architecture/10-config-logging-errors.md) | Override hierarchy, structured logging, error hierarchy, exit codes |
| 11 | [Security](docs/architecture/11-security.md) | Honest threat model, prompt injection, supply chain, secrets |
| 12 | [Performance](docs/architecture/12-performance.md) | Bottleneck analysis, replay skipping, budgets |
| 13 | [Testing Strategy](docs/architecture/13-testing.md) | Property/contract/golden/determinism/e2e layers, eval corpus |
| 14 | [Open Source Strategy](docs/architecture/14-open-source.md) | License, versioning, releases, docs, demo |
| 15 | [ADRs 001–016](docs/architecture/15-adrs.md) | All architectural decision records (seeds `docs/adr/`) |
| 16 | [Risk Analysis](docs/architecture/16-risks.md) | Ranked risk register with mitigations |
| 17 | [Roadmap](docs/architecture/17-roadmap.md) | Phases 0–15 with acceptance and exit criteria |
| 18 | [Critical Review](docs/architecture/18-critical-review.md) | Five-persona review (historical record; findings applied at freeze) |

## The Freeze Package (implementation contract)

| # | Document | What it governs |
|---|----------|-----------------|
| 19 | [Freeze Record](docs/architecture/19-freeze-consistency-and-decisions.md) | Consistency findings + the six resolved decisions (→ ADR-011…016) |
| 20 | [Module Contracts](docs/architecture/20-module-contracts.md) | Binding per-module contracts: purpose, I/O, lifecycle, failure boundaries |
| 21 | [Dependency Rules](docs/architecture/21-dependency-rules.md) | The frozen dependency matrix + graph (source of the CI ruleset) |
| 22 | [Engineering Constitution](docs/architecture/22-engineering-constitution.md) | 75 mandatory engineering laws |
| 23 | [Implementation Standards](docs/architecture/23-implementation-standards.md) | Naming, DI, errors, commits, ADR/versioning conventions |
| 24 | [Implementation Playbooks](docs/architecture/24-implementation-playbooks.md) | Per-phase execution contracts, Phases 0–15 |
| 25 | [Quality Gates](docs/architecture/25-quality-gates.md) | The phase-closing checklist |
| 26 | [Certification](docs/architecture/26-certification.md) | Final CTO review, scores, approval |
| — | [Architecture Changelog](docs/architecture/CHANGELOG.md) | Draft → review → freeze history |

## Key ADRs at a glance
[TypeScript](docs/architecture/15-adrs.md#adr-001-typescript-on-nodejs) · [MCP-first](docs/architecture/15-adrs.md#adr-002-mcp-as-the-primary-interface) · [SQLite+CAS](docs/architecture/15-adrs.md#adr-003-sqlite-index--content-addressed-file-store) · [Local AI only](docs/architecture/15-adrs.md#adr-004-local-ai-only) · [Ollama first](docs/architecture/15-adrs.md#adr-005-ollama-as-first-inference-provider) · [Probe-based capture](docs/architecture/15-adrs.md#adr-006-probe-based-capture-not-ambient-recording) · [Subprocess execution](docs/architecture/15-adrs.md#adr-007-subprocess-execution) · [Behavior over tests](docs/architecture/15-adrs.md#adr-008-behavior-over-tests) · [Local-first invariant](docs/architecture/15-adrs.md#adr-009-local-first-as-invariant) · [Consumer-owned ports](docs/architecture/15-adrs.md#adr-010-interface-driven-design-with-consumer-owned-ports) · ADR-011…016: config format, branch semantics, tree-mutation, suppressions, default model, license — see [Doc 15](docs/architecture/15-adrs.md#freeze-adrs-011016--added-at-architecture-v10-freeze-resolving-the-open-decisions-from-doc-18-8)

## For new contributors
1. Read Doc 00 (laws) → Doc 01 (language) → Doc 22 (constitution). 2. Find your phase in Doc 24. 3. Check your module's contract in Doc 20 and its allowed imports in Doc 21 before writing anything. 4. Attach the Doc 25 checklist to your phase-closing PR.
