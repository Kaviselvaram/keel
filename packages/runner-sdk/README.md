# @keel/runner-sdk

The public contract for KEEL runner plugins ([Doc 20 §15](../../docs/architecture/20-module-contracts.md)). Dependency-free by design: plugins must not inherit KEEL's dependency tree, and the SDK never imports the `keel` package (one-way boundary, C31).

## Runner author guide

A **Runner is a planner, not an executor**. You convert an `ExecutionRequest` into a `SpawnPlan` — command rewriting, interceptor env injection, auxiliary files (e.g. a preload shim). The KEEL engine owns everything dangerous: spawning, process groups / tree kill, timeouts, cancellation, output caps, workspace lifecycle. Your `plan()` must be a **pure function** — no I/O, no clock, no randomness; the contract kit checks this.

```
1. Implement `Runner`:
   - capabilities(): declare runnerId, version, PROTOCOL_VERSION, platforms,
     and the interceptors you can arm — with their implementation versions.
     Claim only what you enforce on EVERY platform you list (half-capabilities
     are banned: Doc 05 §1).
   - plan(request): return a SpawnPlan. If the request requires an
     interceptor you don't offer, THROW — never silently ignore.
2. Prove conformance: run `runnerContractChecks(yourRunner)` in your test
   suite — every check must pass. KEEL refuses runners that fail the kit.
3. Version honestly: armedInterceptors values are implementation versions;
   they participate in baseline fingerprints, so bumping one honestly
   invalidates baselines that depended on it.
```

Trust note for users: a runner plugin ships code that shapes how *your* code is executed. Treat installing one like installing any executable (Doc 11).

## Compatibility

`PROTOCOL_VERSION` (currently 1) gates Runner↔engine compatibility; the engine refuses mismatches at negotiation, before anything runs. Breaking SDK changes only occur at package majors with one-major overlap support in the registry (Doc 20 §15).
