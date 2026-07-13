# `execution/` — Execution Engine (Ring 1)

Contract: [Doc 20 §2](../../../../docs/architecture/20-module-contracts.md) · Design: [Doc 05](../../../../docs/architecture/05-execution-engine.md) · Kill mechanism: [ADR-017](../../../../docs/adr/0017-windows-tree-kill.md)

**Who may import this module:** capture, replay (via ports), composition roots. **What this module imports:** model, shared, observability, `@keel/runner-sdk` — nothing else (CI rule `execution-is-isolated`). **This is the only module in KEEL that spawns processes (C23)** — runner plugins *plan*, the engine spawns, so every plugin inherits correct kill/cap/timeout behavior.

## Execution lifecycle

```mermaid
sequenceDiagram
    participant C as Caller (capture/replay, later phases)
    participant E as ExecutionEngine
    participant R as Runner (planner, pure)
    participant W as Workspace
    participant P as Child process (group/tree)

    C->>E: execute(request, {runnerId, signal, onChunk})
    E->>E: negotiate capabilities (platform, protocol, interceptors)
    E->>R: plan(request)
    R-->>E: SpawnPlan (argv, env, files, armed interceptors)
    E->>W: create + materialize(plan.files)
    E->>W: scan manifest (before)
    E->>P: controlled spawn (group leader / tree root)
    P-->>E: stream chunks (live caps + sink)
    Note over E,P: abort → kill ≤100ms · timeout → kill · cap hit → kill
    P-->>E: close (code | signal)
    E->>W: scan manifest (after) → fs events
    E-->>C: ExecutionResult (exit, streams, fs events, fingerprint, timing)
    E->>W: cleanup (always)
```

## Exit status model (C42: user-code failure is data)

```mermaid
stateDiagram-v2
    [*] --> running : spawn
    running --> exited : child exits (code)
    running --> signaled : external signal
    running --> timeout : engine kill (budget)
    running --> cancelled : engine kill (AbortSignal)
    running --> outputLimit : engine kill (byte cap) or fs budget
```

The engine **throws** only for its own faults: `ExecutionFault` (spawn failure), `EnvironmentError` (runner missing `KEEL_E_EXEC_RUNNER_MISSING`, negotiation failure `KEEL_E_EXEC_NEGOTIATION_FAILED`, plan rejection), `UserError` (unsupported platform, workspace escape, malformed allowlist). Timeout, cancellation, and caps are `ExitStatus` variants, never errors.

## Kill semantics (ADR-017)

POSIX: children are process-group leaders; SIGTERM to `-pid`, grace window (`limits.graceMs`), SIGKILL to the group. Abort initiates the kill synchronously (≤100ms budget, C44). Windows: `taskkill /T /F` tree termination — immediate and forced (no graceful tree signal exists); zero-orphans is asserted by the e2e suite on all platforms.

## Determinism

`ExecutionResult.fingerprint` hashes only conditions (platform, runner identity, armed interceptor versions) — never wall-clock, PIDs, or paths (C7). `startedAtEpochMs`/`durationMs` are alongside, explicitly outside the fingerprint. Manifest paths are workspace-relative POSIX, so fs events compare across platforms.

## Extension

New runners implement the `Runner` port from `@keel/runner-sdk` and must pass `runnerContractChecks` — see the [runner author guide](../../../runner-sdk/README.md). Register at a composition root via `RunnerRegistry`; the engine discovers nothing implicitly.
