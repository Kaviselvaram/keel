# KEEL — Execution Engine

> Document 05 · Status: FROZEN — Architecture v1.0 (2026-07-12)

The Execution Engine is the only component that runs user code. Its design goal is **controlled, observable, repeatable subprocess execution** — not perfect confinement (see Security, Doc 11, for the honest threat model).

---

## 1. Runner Abstraction

**Port: `Runner`** (defined in `@keel/runner-sdk`, consumed by capture/replay via the registry):

- `descriptor()` → id, display name, supported capabilities (which interceptors it can arm: clock, rng, env, network, fs-manifest), runtime detection (e.g., Node version).
- `prepare(probeSpec, mode)` → a materialized execution plan (resolved binary, env, injected preloads). Split from `execute` so plans are inspectable/testable and so replay can verify capability intersection *before* spending an execution.
- `execute(plan, sink, signal)` → streams raw Observations to the sink; resolves with exit status. Never throws for user-code failure (non-zero exit is an observation, not an error); throws only for engine faults (spawn failure, sink overflow).

**Why streaming to a sink rather than returning a blob:** output caps must be enforced *during* execution (a runaway probe writing 10GB to stdout must be truncated-and-flagged live, not after OOM); and progress UX for agents needs live data. Backpressure: sink applies caps; overflow terminates the process and records `exitStatus=output-limit`.

### Built-in runners (v1)

1. **`command` runner** — runs anything (any language) at the process boundary. Interception capabilities: env control and fs-manifest only. **Clock and RNG interception are deliberately not claimed** — they are deep-runner capabilities (Node first); the command runner reports them absent and normalization rules carry the load. (Freeze correction: an earlier draft implied libfaketime-style clock taming "where available"; that half-capability was removed per the platform review — a capability that exists on two of three tier-1 platforms is a determinism lie.) This runner is the universality guarantee: KEEL works for Go/Rust/Python day one, at coarse granularity.
2. **`node` runner** — deep-taming for the flagship ecosystem: injects a preload (via `NODE_OPTIONS=--require`) that pins `Date`/`performance.now` to a virtual clock, seeds `Math.random` and patches `crypto.randomUUID`-class APIs behind an opt-in flag, records/stubs `fetch`/`http(s)` per network policy, and pins `TZ`, locale, and `NODE_ENV`. The preload writes structured side-channel records (recorded network calls, seed report) to a dedicated fd — **never** mixed into stdout/stderr.

**Interceptors are composition, not inheritance:** a runner *composes* a set of interceptor descriptors into its plan; there is no runner base class. Each interceptor is independently testable and independently versioned (an interceptor version participates in the environment fingerprint — a clock-shim bugfix invalidates affected baselines honestly).

---

## 2. Sandbox & Isolation

Honest position: **KEEL executes code the developer already executes.** The sandbox exists to (a) contain *accidents* (probe scribbling outside the repo), (b) enforce *determinism* (no ambient network), (c) bound *resources*. It is not a malware jail, and the docs must say so.

Mechanisms, in order of portability:

| Layer | Mechanism | Platform |
|-------|-----------|----------|
| Working-dir jail | execute in a shadow workdir (copy-on-write clone of watched paths where supported; else scoped temp copy of declared fixture dirs) so fs effects are collected by manifest diff and the real repo is never dirtied by replay | all |
| Env hygiene | allowlist-only env (declared vars + sanitized PATH); everything else stripped — env is a top nondeterminism source *and* a secrets-leak vector | all |
| Resource caps | timeout (kill process *group*), max output bytes, max fs bytes; memory cap where OS allows | all |
| Network deny | Node runner: interceptor refuses non-loopback when policy is `stub`/`record`-complete; command runner: best-effort (documented gap) — OS-level deny (nsjail/sandbox-exec) is a future hardening phase, opt-in | partial |

**Rejected alternative — containers (Docker) as the sandbox:** kills local-first ergonomics (daemon dependency, image drift breaks determinism fingerprinting, Windows pain). Available later as an *optional* runner plugin, never a requirement.

## 3. Timeout, Cancellation, Error Propagation

- Single mechanism end-to-end: `AbortSignal` from adapter → service → engine → `SIGTERM` to process group → grace window → `SIGKILL`. Windows: Job Objects for group kill, **implemented in Phase 2 alongside POSIX process groups** — kill semantics are foundational, not hardening (moved from Phase 10 at freeze, per platform review).
- Timeout is just a deadline-derived abort; cancelled and timed-out executions produce *observations* (`exitStatus=cancelled|timeout`) during capture-time diagnostics, but a cancelled **check** aborts the verdict (no partial verdicts from cancellation — partiality is only a probe-failure policy).
- Engine faults (spawn ENOENT, preload injection failure) throw typed errors; user-code faults are data. This line is the engine's most important contract.

## 4. Language Support Strategy

- **Tier 1 (deep):** Node/TypeScript — full interceptor suite (v1).
- **Tier 2 (process-boundary):** everything via `command` runner (v1).
- **Tier 3 (future plugins):** Python deep runner (`sitecustomize` + `sys.monitoring`), JVM (agent), Go (build-tag shim). Each ships as a separate package implementing `@keel/runner-sdk`, must pass the **runner contract test kit** (LSP made executable): determinism suite, cap enforcement, cancellation latency, observation schema conformance. The SDK's contract tests are the real product here — they are what keeps third-party runners from silently breaking the oracle's trust.

**Failure modes & recovery:** runner not installed → check fails fast with remediation before any execution; interceptor capability mismatch vs baseline → `stale-baseline` path; preload sabotaged by user code (deleting globals) → interceptor report notes tamper, capture verification replay catches resulting nondeterminism.
