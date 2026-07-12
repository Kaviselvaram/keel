# KEEL — Dependency Rules (Frozen Matrix)

> Document 21 · Status: FROZEN — Architecture v1.0 (2026-07-12)
> This matrix is the source of truth for the dependency-cruiser ruleset written in Phase 0. CI fails on any edge not permitted here. Adding an edge requires an ADR.

## 1. Dependency Matrix

`shared/` and `observability/` are importable by every module except where noted and are omitted from "Depends on" for brevity. "Ports of X" means the consumer-owned interface, not X's implementation.

| Module | Depends on | Used by | Forbidden dependencies (explicit) | Allowed abstractions (ports it consumes) | Circular risk | Plugin boundary |
|--------|-----------|---------|-----------------------------------|------------------------------------------|---------------|-----------------|
| `model` | — (stdlib only; not even shared/observability) | everyone | **all modules** | none | none (leaf) | no |
| `shared` | — | everyone | all modules | none | none (leaf) | no |
| `observability` | shared | everyone except model, diff | all domain modules | none | none (leaf) | no |
| `execution` | model, runner-sdk | capture, replay (via port) | storage, config, classify, inference, services, adapters | Logger | **runner-sdk ↔ execution**: broken by SDK owning types, engine owning registry (SDK never imports keel) | **yes — Runner plugins** |
| `capture` | model, ports of execution+storage | services | classify, inference, diff, replay, adapters | Runner, BaselineRepository, ObjectStore, Logger | none | normalization rules (data, not code) |
| `replay` | model, ports of execution+storage(read) | services | diff, capture, classify, inference, adapters | Runner, BaselineRepository(read), ObjectStore(read), Logger | none | no |
| `diff` | model **only** | services | **everything else, incl. observability** | none (pure) | none | comparators (internal registry) |
| `classify` | model, port of inference, config types | services | storage, execution, capture, replay, adapters | InferenceProvider, Logger | none | **yes — heuristic rules, templates** |
| `inference` | shared | **classify only** | everything domain-shaped; model | Logger | none | providers (internal port) |
| `storage` | model | services, capture, replay (via their ports) | engines, services, adapters, classify, inference | Logger | **ports pattern prevents storage→consumer cycles**: ports live in consumer modules; storage implements them without importing consumers' logic (types only via model) | no (closed in v1) |
| `config` | model | composition roots; snapshot passed down | everything else | none | none | no |
| `services` | all engines, classify, storage ports, config | mcp, cli | mcp, cli, inference (direct), sqlite/fs (direct) | all ports | none (top of Ring 2) | no |
| `mcp` | services | — (edge) | engines, storage, classify, inference | ProgressSink | none | transports (later) |
| `cli` | services | — (edge) | engines, storage, classify, inference | ProgressSink | none | no |
| `runner-sdk` (pkg) | — (stdlib) | execution, plugins | keel package entirely | none | see execution row | **is the plugin boundary** |

## 2. Module Dependency Graph

```mermaid
graph TD
    subgraph edges [Adapters — Ring 3]
        MCP[mcp] --> SVC
        CLI[cli] --> SVC
    end
    SVC[services] --> CAP[capture] & REP[replay] & DIF[diff] & CLS[classify]
    SVC --> STOP{{storage ports}}
    CAP --> EXP{{Runner port}} & STOP
    REP --> EXP & STOP
    CLS --> INP{{InferenceProvider port}}
    EXE[execution] -. implements .-> EXP
    STO[storage] -. implements .-> STOP
    INF[inference/ollama] -. implements .-> INP
    EXE --> SDK[@keel/runner-sdk]
    PLUG[third-party runner plugins] -. implement .-> SDK
    CAP & REP & DIF & CLS & EXE & STO & SVC --> MOD[model]
    CFG[config] --> MOD
    CFG -. snapshot injected at composition root .-> SVC
    classDef port fill:#fff,stroke-dasharray: 5 5
    class EXP,STOP,INP port
```

Solid arrows = compile-time imports (the only ones dependency-cruiser permits). Dashed = implementation/injection relationships wired exclusively at the two composition roots (`cli/main`, `mcp/main`) — the composition roots are the **only** files allowed to import both a port's consumer and its implementation.

## 3. Standing Rules

1. **No cycles, ever, at file granularity** — not just module granularity (depcruise `no-circular` on `src/**`).
2. **Ports live with consumers** (DIP). An implementation module never imports its consumer.
3. **Single AI chokepoint:** the only permitted importer of `inference/` is `classify/`; the only permitted importers of `classify/` are `services/` and the composition roots.
4. **Single I/O chokepoints:** subprocess spawning only in `execution/`; SQLite/CAS only in `storage/`; sockets only in `inference/` (loopback-validated); env/file config reads only in `config/`.
5. **Ring rule:** Ring N may not import Ring N+1 (rings per Doc 01 §2; services sit at the 2/3 seam and are the ceiling for Ring 2).
6. **Plugin boundary is one-way:** plugins import `@keel/runner-sdk`; nothing in the SDK imports `keel`; KEEL discovers plugins via the registry, never by direct import.
