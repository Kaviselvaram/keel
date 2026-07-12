# KEEL — Module Contracts (Implementation Contract)

> Document 20 · Status: FROZEN — Architecture v1.0 (2026-07-12)
> This is the binding contract for every module in `packages/keel/src/` plus `@keel/runner-sdk`. Implementation phases may not alter a contract without a new ADR and a version bump of this document. Fields: each contract states purpose, responsibilities (public vs internal), inputs/outputs, dependencies, forbidden dependencies, extension points, lifecycle, ownership, failure boundary.

Conventions applying to **all** modules (stated once, DRY):
- All public async operations accept an `AbortSignal` and honor it within the module's stated cancellation budget.
- All cross-module data is Behavior Model types or module-owned DTOs — never another module's internals.
- Ownership means: the named module is the only constructor of that data/resource; everyone else receives it.
- Failure boundary means: the error types allowed to escape the module (from the Doc 10 hierarchy), and what must never escape.

---

## 1. `model/` — Behavior Model
- **Purpose:** the shared vocabulary: entities, invariants, canonical serialization, content hashing, schema versions.
- **Public responsibilities:** construct-and-validate entities; canonical bytes; hashes; type guards; version constants.
- **Internal responsibilities:** canonicalization rules (key ordering, number formatting, encoding normalization).
- **Inputs/Outputs:** plain data in → validated immutable entities, canonical bytes, hashes out.
- **Dependencies:** stdlib only. **Forbidden:** every other module.
- **Extension points:** new Observation variants (tagged union + schema-version bump).
- **Lifecycle:** stateless; no init/teardown. **Ownership:** entity *definitions* and canonical form.
- **Failure boundary:** only `InternalError` on invariant violation (constructing invalid entities is a KEEL bug); never throws on valid data. No I/O errors possible.

## 2. `execution/` — Execution Engine (+ built-in runners)
- **Purpose:** the only module that runs user code.
- **Public responsibilities:** `Runner` port (via runner-sdk types), `RunnerRegistry` (discovery, capability reporting), execution of a prepared plan with streaming observations, caps, group-kill, shadow workdir.
- **Internal responsibilities:** platform kill semantics (process groups / Job Objects), interceptor plan assembly, spill-file management, env allowlisting.
- **Inputs:** ProbeSpec + mode (record/replay) + interception settings + signal. **Outputs:** raw Observation stream + exit status + interceptor report.
- **Dependencies:** model, runner-sdk, observability port. **Forbidden:** storage, classify, inference, config-loading, services, adapters.
- **Extension points:** runner plugins (`@keel/runner-sdk`, contract-kit gated); interceptor descriptors per runner.
- **Lifecycle:** registry built at composition root; executions are per-call, no pooling in v1.
- **Ownership:** subprocesses, shadow workdirs, raw observations (until handed to capture/replay).
- **Failure boundary:** may emit `ExecutionFault` (spawn/injection failure) and `EnvironmentError` (runner missing). **User-code failure is data, never an error** — this is the module's most important contractual line. Cancellation budget: SIGTERM ≤ 100ms after abort; SIGKILL after configured grace.

## 3. `capture/` — Capture Engine
- **Purpose:** turn executions into sealed baselines.
- **Public responsibilities:** capture pipeline (resolve → execute → normalize → persist → verify → seal); the Normalizer and its ruleset registry.
- **Internal responsibilities:** volatile-value scrubbing, secret detection, structure sniffing, canonical observation ordering, verification-replay orchestration.
- **Inputs:** ConfigSnapshot (probes, rules), execution results. **Outputs:** sealed Baseline (or structured rejection naming the flapping path).
- **Dependencies:** model, execution (port), storage ports (BaselineRepository, ObjectStore), observability. **Forbidden:** classify, inference, diff, replay, adapters.
- **Extension points:** normalization rules (data-driven matchers, user- and community-contributed); ruleset is versioned.
- **Lifecycle:** per-operation. **Ownership:** Snapshots (record-mode), Baselines, normalization ruleset version.
- **Failure boundary:** `UserError` (bad probe, nondeterministic probe), `EnvironmentError`; a partially persisted baseline must be impossible (transaction contract with storage).

## 4. `replay/` — Replay Engine
- **Purpose:** reconstruct baseline conditions and produce comparable fresh snapshots.
- **Public responsibilities:** provenance/capability validation (per-field policy, ADR-012); condition materialization; replay-mode execution orchestration; normalization reuse (same ruleset version as baseline).
- **Internal responsibilities:** interceptor arming from recorded conditions (epoch, seeds, network stubs); runner capability negotiation.
- **Inputs:** Baseline (inputs + conditions only — contractually blind to baseline *outputs*), signal. **Outputs:** replay Snapshots (+ `stale-baseline` structured outcome on hard provenance mismatch).
- **Dependencies:** model, execution (port), storage read ports. **Forbidden:** diff (must not compare), capture, classify, inference, adapters.
- **Extension points:** condition kinds tied to interceptor registry.
- **Lifecycle/Ownership:** per-operation; owns replay Snapshots.
- **Failure boundary:** `UserError` (missing runner/model of provenance), `EnvironmentError`; an unrecorded effect during stub replay is a **Divergence-feeding fact**, not an error.

## 5. `diff/` — Diff Engine
- **Purpose:** pure deterministic comparison.
- **Public responsibilities:** snapshot-pair comparison honoring ignore rules → ordered typed Divergences; the divergence taxonomy; comparator registry.
- **Internal responsibilities:** Merkle short-circuit walk, LCS/identity-keyed array matching, size-ceiling policy.
- **Inputs:** two Snapshots + validated rules. **Outputs:** `Divergence[]`, deterministically ordered.
- **Dependencies:** model only. **Forbidden:** all I/O, config loading, observability, everything else. No logger by design.
- **Extension points:** comparator per Observation kind; identity-key rules.
- **Lifecycle:** stateless pure functions. **Ownership:** Divergences and their `stableId` derivation.
- **Failure boundary:** any throw is `InternalError` (fatal by design — a diff bug must never degrade silently).

## 6. `classify/` — Classification Engine
- **Purpose:** advisory intent labels on divergences.
- **Public responsibilities:** two-tier classification (heuristic registry, LLM tier), evidence-packet assembly, budget/circuit-breaker enforcement, annotation production.
- **Internal responsibilities:** prompt template management (versioned artifacts), output schema validation, confidence banding, diff-hunk ranking.
- **Inputs:** Divergences + code diff + probe metadata + prior annotations + budget + signal. **Outputs:** Annotations only. Never actions, never fixes, never mutations of facts.
- **Dependencies:** model, inference (port), config types, observability. **Forbidden:** storage (receives evidence, returns annotations — services persist), execution, capture, replay, diff internals, adapters.
- **Extension points:** heuristic rules (data-registered, individually tested, ruleId-attributed); templates (versioned, eval-gated).
- **Lifecycle:** per-check-run instance (circuit-breaker state scoped to one run).
- **Ownership:** Annotations, evidence packets, templates.
- **Failure boundary:** total failure degrades to `uncertain(...)` annotations — no error from this module may fail a check. `EnvironmentError` is swallowed-and-annotated here, uniquely in the system, because this module is contractually non-critical (L2).

## 7. `inference/` — Inference Providers
- **Purpose:** transport to local model servers.
- **Public responsibilities:** `InferenceProvider` port (capabilities, complete), loopback-only endpoint validation (constructor-time rejection of non-loopback URLs — L3 structural enforcement), Ollama implementation.
- **Internal responsibilities:** HTTP details, streaming, model listing.
- **Inputs:** provider request DTOs. **Outputs:** provider response DTOs. Knows nothing of divergences or code.
- **Dependencies:** shared (errors) only. **Forbidden:** everything domain-shaped. **Only `classify/` may import this module.**
- **Extension points:** additional providers (llama.cpp-server, LM Studio) behind the same port + contract test.
- **Lifecycle:** constructed at composition root from ConfigSnapshot; health-checked lazily.
- **Failure boundary:** `EnvironmentError` only (unreachable, timeout, malformed response). Cancellation ≤ 500ms.

## 8. `storage/` — Persistence
- **Purpose:** durable local state.
- **Public responsibilities:** implementations of consumer-owned ports (BaselineRepository, VerdictRepository, SuppressionRepository, ObjectStore); migrations; advisory locking; GC; integrity verification.
- **Internal responsibilities:** SQLite schema, WAL config, CAS sharding/atomic-rename/compression, backup-before-migrate.
- **Inputs/Outputs:** Behavior Model entities in/out; object hashes.
- **Dependencies:** model, observability. **Forbidden:** engines, services, adapters, classify, inference. **SQLite and the filesystem layout are invisible above this module.**
- **Extension points:** none in v1 (storage is deliberately closed — a second backend is a non-goal; the ports are the seam if that ever changes).
- **Lifecycle:** opened at composition root (migrations run), closed on shutdown; one writer per store via lock file.
- **Ownership:** everything under the store directory; schema versions; retention policy execution.
- **Failure boundary:** `EnvironmentError` (lock, disk), `IntegrityError` (hash mismatch — quarantine, never auto-heal). Crash at any point must leave the store consistent (WAL + staging-rename contract).

## 9. `config/` — Configuration
- **Purpose:** one validated, immutable, hashed view of configuration.
- **Public responsibilities:** layered load (defaults → project JSONC → user file → env → invocation), schema validation with path-precise errors, `ConfigSnapshot` + behavior-hash (canonical parsed form, ADR-011), enforcement of the project-vs-user key split.
- **Internal responsibilities:** JSONC parsing, merge semantics, unknown-key rejection.
- **Dependencies:** model (hashing), shared. **Forbidden:** everything else; **no other module reads files/env for configuration.**
- **Extension points:** schema grows additively; new keys require defaults + docs (generated reference).
- **Lifecycle:** loaded at process start; re-loaded on file change only in watch mode (new frozen snapshot, never mutation).
- **Ownership:** ConfigSnapshot, configHash.
- **Failure boundary:** `UserError` exclusively (config problems are always user-fixable, and the error message quality bar of Doc 10 C2 applies doubly here).

## 10. `observability/` — Logging & Diagnostics
- **Purpose:** local-only structured logging, spans, doctor.
- **Public responsibilities:** `Logger` port, span timing, correlation-ID propagation helpers, `doctor` probes, diagnostics bundle assembly.
- **Internal responsibilities:** NDJSON sink, rotation, redaction rules.
- **Dependencies:** shared only. **Forbidden:** everything else. **No global logger exists; injection only.**
- **Extension points:** doctor probes registered per module at composition root.
- **Lifecycle:** constructed first at composition root, closed last.
- **Ownership:** log files, redaction policy.
- **Failure boundary:** logging failures never propagate (best-effort by contract); doctor reports `EnvironmentError` findings as data.

## 11. `services/` — Application Services
- **Purpose:** use-case orchestration; the seam between engines and the world.
- **Public responsibilities:** CaptureService, CheckService, ReportService, BaselineAdminService; progress event streams; the facts-before-annotations persistence ordering; partial-failure policy; tree-mutation detection (ADR-013); diff-scoped probe selection.
- **Internal responsibilities:** workflow sequencing, parallelism limits, budget allocation, verdict assembly.
- **Inputs:** validated request DTOs from adapters + signal. **Outputs:** persisted Verdicts (and projections thereof), progress events.
- **Dependencies:** all engines, storage ports, classify, config, observability. **Forbidden:** mcp, cli, inference (directly), SQLite/fs directly.
- **Extension points:** new use cases only (existing service contracts are frozen for v1).
- **Lifecycle:** constructed at composition root; stateless between calls except the store lock.
- **Ownership:** CheckRuns, Verdicts, the exit-status/verdict-status mapping.
- **Failure boundary:** translates engine errors into Verdict statuses or typed failures; **nothing below adapters ever sees a raw engine stack trace as a result.**

## 12. `mcp/` — MCP Server Adapter
- **Purpose:** agent-facing projection of services over stdio JSON-RPC.
- **Public responsibilities:** tool registration (schemas as published contract), initialize/shutdown handshake, progress notification bridging, busy semantics, protocol-revision compat seam.
- **Internal responsibilities:** request validation, verdict → tool-result projection (structured doc + summary line).
- **Dependencies:** services, shared, observability. **Forbidden:** engines, storage, classify, inference, model internals beyond DTO projection.
- **Extension points:** new tools (ADR-gated), additional transports (HTTP later) behind the same tool handlers.
- **Lifecycle:** process lifetime = MCP session; shutdown fans abort to all in-flight operations; no orphaned subprocesses (contract with execution's group-kill).
- **Failure boundary:** JSON-RPC protocol errors for malformed requests only; all domain outcomes are successful structured results (Doc 09 §4).

## 13. `cli/` — CLI Adapter
- Same contract shape as `mcp/`: projection only, services-only dependency, five-code exit contract, human rendering derived from the same persisted Verdict document. Composition root for the CLI process lives here.

## 14. `shared/` — Leaf Utilities
- **Purpose:** error hierarchy, Result conventions, ULID generation, time-source port.
- **Dependencies:** none. **Forbidden importers:** none (universal). **Growth rule:** any addition beyond errors/ids/result/time requires review sign-off — a fat `shared/` is the first symptom of boundary decay.

## 15. `@keel/runner-sdk` — Plugin Contract (separate package)
- **Purpose:** the frozen public boundary for third-party runners.
- **Public responsibilities:** Runner port types, Observation schemas, capability descriptors, the contract-test kit (determinism, caps, cancellation, schema conformance, no-egress).
- **Dependencies:** none beyond stdlib (deliberately dependency-free — plugins must not inherit KEEL's dep tree).
- **Versioning:** independent semver; breaking changes only at majors with one-major overlap support in the registry.
- **Failure boundary:** N/A (types + test kit). The kit is the enforcement mechanism for LSP across the plugin ecosystem.
