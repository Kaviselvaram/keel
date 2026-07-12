# KEEL — Module Design, LLD Conventions & Repository Structure

> Document 03 · Status: FROZEN — Architecture v1.0 (2026-07-12)

---

## 1. Packaging Decision: Modular Monolith, Minimal Workspace

**Decision (amended at freeze):** a pnpm workspace with exactly **two** packages, not a micro-package monorepo and not a single flat package.

| Package | Contents | Published? |
|---------|----------|------------|
| `keel` | Everything in Rings 0–2 + services + CLI + MCP server. One installable unit. | yes (npm, bin: `keel`) |
| `@keel/runner-sdk` | The public contract for third-party runner plugins: `Runner` port types, contract-test kit, observation schemas. In the workspace from Phase 0 because the Node deep runner's preload (Phase 7) consumes these types across a real package boundary. | yes |

The benchmark harness lives at `tests/bench/` as a folder, **not** a package, until Phase 11 extracts it as `@keel/bench` for plugin authors (freeze amendment per OSS-maintainer review: don't pay package overhead before an external consumer exists).

**Why:** micro-packages (`@keel/diff`, `@keel/storage`, …) impose versioning, changelog, and release-coordination tax with zero benefit while one team ships one product (YAGNI). A single flat package, however, would leave the runner plugin contract undefined — and that contract is the one boundary external parties build against, so it must version independently and stay dependency-light. Internal module boundaries inside `keel` are enforced by **dependency-cruiser rules in CI**, which gives us monorepo discipline without monorepo overhead. If a module later needs extraction (e.g., diff engine reused elsewhere), clean internal boundaries make that a mechanical move.

**Alternatives rejected:** Nx/Turborepo full monorepo (tooling weight deters OSS contributors); single package with plugins-as-forks (kills the plugin ecosystem).

---

## 2. Repository Structure

```
keel/
├── packages/
│   ├── keel/
│   │   ├── src/
│   │   │   ├── model/          # Ring 0 — Behavior Model: entities, canonical serializer, hashing
│   │   │   ├── capture/        # Ring 1 — capture pipeline, normalization policy
│   │   │   ├── replay/         # Ring 1 — condition reconstruction
│   │   │   ├── diff/           # Ring 1 — pure structural comparison
│   │   │   ├── execution/      # Ring 1 — runner registry, sandbox, interceptors
│   │   │   │   └── runners/    #   built-in: command (generic), node
│   │   │   ├── classify/       # Ring 2 — heuristic tier, LLM tier, evidence packets
│   │   │   ├── inference/      # Ring 2 — provider port + ollama provider
│   │   │   ├── storage/        # Ring 2 — sqlite repos, CAS, migrations, GC
│   │   │   ├── config/         # Ring 2 — loading, schema, snapshot, hashing
│   │   │   ├── observability/  # Ring 2 — logger port, spans, doctor probes
│   │   │   ├── services/       # use-case orchestration (Capture/Check/Report/Admin)
│   │   │   ├── mcp/            # Ring 3 — MCP server adapter
│   │   │   ├── cli/            # Ring 3 — CLI adapter
│   │   │   └── shared/         # error hierarchy, result types, ids — leaf utilities only
│   │   └── package.json
│   └── runner-sdk/
├── docs/
│   ├── architecture/           # this blueprint (00–18)
│   ├── adr/                    # one file per ADR, append-only
│   ├── guides/                 # user docs: getting started, probes, MCP setup, CI
│   └── internals/              # contributor docs: normalization rules, schema reference
├── tests/
│   ├── e2e/                    # black-box: real CLI/MCP against fixture repos
│   ├── fixtures/               # small sample projects (node app, python script, flaky app)
│   ├── bench/                  # determinism & perf benchmark harness (extracted as @keel/bench at Phase 11)
│   └── regression-corpus/     # known-regression benchmark cases (feeds tests/bench)
├── examples/
│   ├── node-express-api/       # each example: README + keel.config + scripted demo
│   ├── python-cli/
│   └── agent-loop/             # wiring KEEL into Claude Code / other MCP clients
├── scripts/                    # release, schema-docs generation, corpus tooling (no build logic hidden here)
├── configs/                    # shared tsconfig base, eslint, dependency-cruiser rules
├── .github/
│   ├── workflows/              # ci.yml (lint+depcruise+unit+integration), e2e-matrix.yml (3 OS), release.yml, determinism-gate.yml
│   ├── ISSUE_TEMPLATE/
│   └── PULL_REQUEST_TEMPLATE.md
├── CONTRIBUTING.md · CODE_OF_CONDUCT.md · SECURITY.md · LICENSE (Apache-2.0) · README.md
```

**Why each top-level folder exists:** `packages/` isolates publishable units; `docs/architecture` vs `docs/guides` separates "why it's built this way" from "how to use it" (different audiences, different change cadence); `tests/` at the root holds only cross-package black-box suites — unit/integration tests live next to their module inside each package (`src/diff/__tests__/`) so they move with the code; `tests/fixtures` are real miniature projects because KEEL's subject matter *is* other people's repos; `examples/` are executable documentation and double as e2e smoke targets; `scripts/` keeps operational tooling out of package code; `configs/` centralizes shared tool config so packages don't drift; `.github/` carries the CI gates that enforce this document (dependency rules, determinism gate, zero-egress test).

---

## 3. Module Design (per module: responsibility, exports, dependencies, forbidden dependencies, extension points)

Interfaces below are described by name and semantics only — no code, per session scope.

### 3.1 `model/` (Behavior Model)

- **Responsibility:** Entity definitions with invariants; canonical JSON serialization (sorted keys, explicit number/encoding rules, no NaN/Infinity, UTF-8 NFC); SHA-256 content hashing; schema version tags on every persisted document.
- **Exports:** entity types (Probe, Snapshot, Baseline, Divergence, Verdict, …), `canonicalSerialize`, `contentHash`, schema-version constants, type guards.
- **Dependencies:** none (stdlib only).
- **Forbidden:** everything else. Any import into `model/` from another KEEL module fails CI.
- **Extensibility:** new Observation kinds are added as new tagged variants with a schema-version bump; old readers must reject unknown *major* versions and tolerate unknown *optional* fields (forward-compat rule).
- **Failure modes:** none at runtime (pure). The risk is *specification drift* — mitigated by golden-file serialization tests that fail if canonical bytes change.

### 3.2 `capture/`

- **Responsibility:** Capture pipeline and **normalization policy** (the single place that knows which observation fields are volatile and how to scrub them).
- **Exports:** `CaptureEngine` (used by services), `Normalizer`, normalization rule registry.
- **Dependencies:** model, execution (port), storage (ports), config types, observability port.
- **Forbidden:** classify, inference, mcp, cli.
- **Failure modes / recovery:** probe execution failure → capture aborts with the probe's stderr attached (a baseline with holes is worse than no baseline); nondeterministic probe detected by verification replay → structured rejection naming the flapping observation path; partial persistence → impossible by transaction design.
- **Extensibility:** normalization rules are data-driven matchers (path pattern + scrub strategy); users add rules in config; built-in rule set versioned so old baselines record which rules produced them.

### 3.3 `replay/`

- **Responsibility:** Reconstruct execution conditions from a baseline; arm interceptors in replay mode; produce comparable snapshots.
- **Exports:** `ReplayEngine`.
- **Dependencies:** model, execution (port), storage (read ports).
- **Forbidden:** diff (replay must not compare — SRP), capture, classify.
- **Failure modes / recovery:** missing runtime (Node major changed) → `stale-baseline` verdict path, remediation text "re-capture or install X"; missing recorded network fixture during stub replay → divergence of kind `unrecorded-effect` (a *fact*: the code now makes a call it didn't before), not an error.
- **Extensibility:** condition kinds (new interceptor types) registered per runner capability; replay negotiates the intersection of baseline-required vs runner-supported capabilities and fails loudly on gaps.

### 3.4 `diff/`

- **Responsibility:** Pure structural comparison. Detailed design in Doc 06.
- **Exports:** `diffSnapshots(baseline, candidate, rules) → Divergence[]` (conceptually), divergence kind taxonomy, ignore-rule matcher types.
- **Dependencies:** model only.
- **Forbidden:** all I/O modules, config loading, observability (pure functions don't log; callers time them).
- **Failure modes:** none recoverable — any thrown error here is a developer error (invariant violation) and is fatal-by-design so it gets fixed.
- **Extensibility:** comparator registry keyed by Observation kind; new kinds plug in a comparator without touching the walker.

### 3.5 `execution/`

Detailed in Doc 05. **Exports:** `Runner` port, `RunnerRegistry`, interceptor descriptors, sandbox policy types. **Forbidden:** storage, classify, inference, services. **Extensibility:** runner plugins via `@keel/runner-sdk`.

### 3.6 `classify/` and `inference/`

Detailed in Doc 07. **Forbidden:** `classify` may not import storage (it receives evidence, returns annotations — services persist); `inference` may not import anything domain-shaped. Nothing outside `classify` may import `inference` (single AI chokepoint, CI-enforced).

### 3.7 `storage/`

Detailed in Doc 08. **Exports:** repository implementations + `ObjectStore`, migration runner, `gc`. **Forbidden:** engines, services, adapters (storage is a leaf).

### 3.8 `config/`

Detailed in Doc 10. **Exports:** `loadConfig`, `ConfigSnapshot`, schema, config hash. **Forbidden:** everything except model + shared.

### 3.9 `services/`

- **Responsibility:** Use cases: transactional boundaries, workflow ordering, progress events, cancellation fan-out, verdict persistence ordering (facts before annotations).
- **Exports:** `CaptureService`, `CheckService`, `ReportService`, `BaselineAdminService`, progress event types.
- **Dependencies:** all engines + storage ports + classify + config + observability. This is the composition root's client.
- **Forbidden:** mcp, cli (inversion: adapters depend on services).
- **Failure modes:** the service layer is where partial failure becomes policy — e.g., "3 of 50 probes failed to execute" yields verdict `error(partial)` with per-probe detail, never a silent subset comparison.

### 3.10 `mcp/` and `cli/`

Detailed in Doc 09 (MCP). Both are projection layers: parse input → call service → project Verdict to transport. **Forbidden:** any import from engines or storage.

### 3.11 `shared/`

- **Responsibility:** error hierarchy (Doc 10), `Result` conventions, ID generation (ULIDs), time source port.
- **Rule:** `shared/` may not import anything; anything may import `shared/`. Kept deliberately tiny — a growing `shared/` is a design smell and gets flagged in review.

---

## 4. LLD Conventions (apply to every module)

- **Ports are defined by consumers** (DIP): the port type lives in the consuming module; implementations live in infrastructure modules; wiring happens only in the composition root (`cli/main`, `mcp/main`).
- **No DI container.** Manual constructor injection at two composition roots. A container is unjustifiable complexity at this scale (KISS); revisit only if composition roots exceed ~100 lines of wiring.
- **All async APIs accept `AbortSignal`** and a deadline; all long operations emit progress events through an injected sink.
- **Errors:** engines throw typed errors from the shared hierarchy; services translate to Verdict statuses or user-facing failures; adapters translate to transport codes. No error crosses a boundary as a bare string.
- **Immutability:** persisted documents are frozen; "updates" are new versions or append-only annotations.
- **Every public module surface has a contract test** that a re-implementation must pass (this is what makes the architecture testable rather than aspirational).
