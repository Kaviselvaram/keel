# KEEL — High-Level Design & System Diagrams

> Document 02 · Status: FROZEN — Architecture v1.0 (2026-07-12)

---

## 1. Major Components

| Component | Responsibility | Ring |
|-----------|----------------|------|
| **keel-core (Behavior Model)** | Entities, invariants, canonical JSON serialization, content hashing | 0 |
| **Capture Engine** | Baseline creation pipeline (resolve → execute → normalize → persist) | 1 |
| **Replay Engine** | Condition reconstruction and re-execution | 1 |
| **Diff Engine** | Pure structural comparison → typed divergences | 1 |
| **Execution Engine** | Runner registry, subprocess sandbox, interceptors, streaming | 1 |
| **Classification Engine** | Heuristic tier + LLM tier intent labeling | 2 |
| **Inference Layer** | Provider abstraction over local model servers (Ollama first) | 2 |
| **Storage Layer** | SQLite index + content-addressed object store, migrations, GC | 2 |
| **Config System** | Layered load, validation, immutable snapshot, config hash | 2 |
| **Observability** | Structured local logging, spans, correlation IDs, doctor | 2 |
| **Application Services** | `CaptureService`, `CheckService`, `ReportService`, `BaselineAdminService` — use-case orchestration | 2/3 seam |
| **MCP Server** | stdio JSON-RPC adapter exposing tools to agents | 3 |
| **CLI** | Human/CI adapter over the same services | 3 |

The **Application Services** layer is the deliberate seam between "engines" and "the outside world." It owns transactions ("capture is atomic"), workflow ordering, and cancellation propagation. Engines stay ignorant of use cases; adapters stay ignorant of engines.

---

## 2. Overall Architecture Diagram

```mermaid
graph TB
    subgraph Consumers
        AGENT[AI Coding Agent]
        DEV[Developer / CI]
    end

    subgraph KEEL [KEEL Process]
        MCPS[MCP Server<br/>stdio JSON-RPC]
        CLI[CLI]
        SVC[Application Services<br/>Capture · Check · Report · Admin]

        subgraph DET [Deterministic Core — no AI imports allowed]
            CAPE[Capture Engine]
            REPE[Replay Engine]
            DIFE[Diff Engine - pure]
            EXEE[Execution Engine]
        end

        subgraph ADV [Advisory Layer]
            CLSE[Classification Engine]
            HEUR[Heuristic Tier]
            INFP[Inference Port]
        end

        subgraph INFRA [Infrastructure]
            CFG[Config Snapshot]
            LOG[Observability]
            SQL[(SQLite index)]
            CAS[(Content-addressed<br/>object store)]
        end
    end

    subgraph Local [User's machine — loopback only]
        OLL[Ollama / local model server]
        REPO[User's repository<br/>+ probes]
    end

    AGENT -->|MCP tools| MCPS
    DEV -->|commands| CLI
    MCPS --> SVC
    CLI --> SVC
    SVC --> CAPE & REPE & DIFE & CLSE
    CAPE --> EXEE
    REPE --> EXEE
    EXEE -->|subprocess + interceptors| REPO
    CLSE --> HEUR
    CLSE --> INFP
    INFP -->|HTTP loopback| OLL
    CAPE --> SQL & CAS
    REPE --> SQL & CAS
    SVC --> SQL
```

---

## 3. Request Lifecycle: `keel check` (the flagship flow)

1. **Ingress** (MCP tool call `keel_check` or CLI `keel check`). Adapter validates transport-level input, mints a correlation ID, calls `CheckService.check(request, signal)`.
2. **Config resolution.** Service obtains the frozen `ConfigSnapshot` (already loaded at process start; re-validated on file change in watch mode).
3. **Baseline selection.** `BaselineRepository` resolves the target baseline (explicit ID, or "latest for this branch"). Provenance is validated: if the baseline's config hash or environment fingerprint mismatches current, the verdict is `stale-baseline` — *not* a diff against garbage. This guardrail is a first-class outcome, not an error.
4. **Replay.** Replay Engine reconstructs each probe's conditions and dispatches to the Execution Engine (bounded parallelism). Raw observations → normalization → fresh Snapshots. Progress streams to the adapter (MCP progress notifications / CLI spinner).
5. **Diff.** For each probe: baseline snapshot vs. replay snapshot → ordered divergence list. Hash short-circuit: identical snapshot hashes skip structural descent entirely.
6. **Verdict assembly (deterministic milestone).** A complete, valid Verdict now exists: `clean` or `diverged` with N divergences. **It is persisted at this point**, before any AI runs. A crash after this point loses annotations, never facts.
7. **Classification (advisory, budgeted).** Heuristic tier labels what it can. Remaining divergences batch to the LLM tier with a wall-clock budget and cancellation. Results merge into the verdict as annotations; failures mark divergences `uncertain(reason=inference_unavailable)`.
8. **Egress.** Adapter projects the Verdict: MCP returns the structured document; CLI renders human output from the same document. Exit code / tool result follows the five-code contract (Doc 10 §C2): `0` clean · `1` diverged · `2` user-actionable (incl. `stale-baseline`) · `3` environment · `4` internal.

**Response lifecycle invariant:** every response is a projection of a persisted Verdict. There is no path where an adapter fabricates response content — replaying `keel report <verdict-id>` must reproduce exactly what the caller saw.

---

## 4. Sequence Diagram — Regression Check

```mermaid
sequenceDiagram
    participant A as Agent (MCP client)
    participant M as MCP Server
    participant S as CheckService
    participant R as Replay Engine
    participant X as Execution Engine
    participant D as Diff Engine
    participant C as Classifier
    participant O as Ollama (local)
    participant P as Storage

    A->>M: tools/call keel_check
    M->>S: check(request, signal)
    S->>P: load baseline + provenance
    P-->>S: Baseline (snapshots, conditions)
    alt provenance mismatch
        S-->>M: Verdict(status=stale-baseline)
        M-->>A: structured result + remediation
    end
    loop each probe (bounded parallel)
        S->>R: replay(probe, conditions)
        R->>X: execute(invocation, interceptors)
        X-->>R: raw observations (streamed)
        R-->>S: replay Snapshot
        S->>D: diff(baseline snap, replay snap, rules)
        D-->>S: Divergence[]
    end
    S->>P: persist Verdict (facts only)
    Note over S: Deterministic milestone — verdict is complete
    S->>C: classify(divergences, codeDiff, budget)
    C->>C: heuristic tier
    C->>O: residual batch (loopback HTTP)
    O-->>C: labels + rationale
    C-->>S: annotations (or degraded)
    S->>P: persist annotations
    S-->>M: Verdict
    M-->>A: structured verdict + summary
```

---

## 5. Baseline Capture Workflow

```mermaid
flowchart LR
    A[capture requested] --> B[freeze ConfigSnapshot<br/>compute config hash]
    B --> C[resolve probes<br/>from config]
    C --> D[fingerprint environment<br/>runtime versions, OS, arch]
    D --> E[execute each probe<br/>with interceptors ON<br/>record mode]
    E --> F[normalize raw observations<br/>volatile-value scrubbing<br/>canonical ordering]
    F --> G[serialize canonically<br/>hash content]
    G --> H[write blobs to CAS<br/>write index rows to SQLite<br/>single transaction]
    H --> I[verification replay<br/>immediate re-run, expect 0 divergences]
    I -->|clean| J[baseline sealed<br/>immutable from here]
    I -->|diverged| K[reject: probe is nondeterministic<br/>report which observation flapped]
```

Step **I** is a deviation worth defending: a baseline is only sealed after an immediate self-replay proves the probe is deterministic under our interception. This converts "flaky probe" from a runtime false-positive (destroys trust) into a capture-time error with a pinpointed cause (builds trust). It doubles capture cost; capture is rare and trust is everything, so the trade is correct.

## 6. Replay Workflow

```mermaid
flowchart LR
    A[baseline snapshot conditions] --> B[verify runner availability<br/>same runtime major version]
    B --> C[materialize inputs<br/>stdin, env allowlist, fixture files]
    C --> D[arm interceptors in replay mode<br/>clock: baseline epoch<br/>rng: baseline seed<br/>network: stub from recordings]
    D --> E[spawn sandboxed subprocess]
    E --> F[stream + cap outputs]
    F --> G[normalize → replay Snapshot]
```

## 7. Classification Workflow

```mermaid
flowchart TD
    V[Verdict facts persisted] --> H{Heuristic tier}
    H -->|edited-code overlap, config-change match,<br/>version-string rules| L1[labeled: intended/collateral<br/>deterministic, confidence=rule]
    H -->|no rule fires| Q[LLM queue]
    Q --> B{model available?<br/>budget remaining?}
    B -->|no| U[uncertain: inference_unavailable]
    B -->|yes| P[compose evidence packet:<br/>divergence + code diff hunks + probe meta]
    P --> M[local model call<br/>schema-constrained output]
    M -->|valid JSON| L2[labeled + confidence + rationale]
    M -->|invalid / timeout| RT{retry ≤1}
    RT -->|fail| U
    L1 & L2 & U --> A[annotations merged into Verdict]
```

## 8. Persistence Workflow

```mermaid
flowchart LR
    OBJ[Snapshot / recording / verdict body] --> SER[canonical serialize]
    SER --> HASH[SHA-256 → object id]
    HASH --> EXIST{object exists in CAS?}
    EXIST -->|yes| REF[reuse — dedup for free]
    EXIST -->|no| WRITE[write temp + fsync + atomic rename<br/>.keel/objects/ab/cdef...]
    REF & WRITE --> IDX[(SQLite: baselines, probes,<br/>snapshots, verdicts, divergences<br/>— rows reference object ids)]
    IDX --> TX[single transaction per logical operation]
```

---

## 9. Component Interaction Rules (summary)

1. Adapters call Services. Services orchestrate Engines. Engines exchange Behavior Model types.
2. Only the Execution Engine spawns processes. Only Storage touches SQLite/CAS. Only Inference opens sockets (loopback only). Only Config reads env.
3. Cancellation is an `AbortSignal` threaded from adapter to subprocess kill — every long operation accepts one (single mechanism, no bespoke cancellation flags).
4. All cross-component data is immutable after construction. Engines never mutate a Snapshot or Verdict in place; annotation is a persisted, append-only operation.
