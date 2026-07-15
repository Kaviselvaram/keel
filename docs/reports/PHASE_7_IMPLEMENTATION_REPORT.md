# Phase 7 Implementation Report — Node Deep Runner

> Commit: `24b83da` · Date: 2026-07-15 · CI: full matrix green (fast lane, 8-injection gate self-test, 6 OS×Node jobs, dogfood everywhere)
> Governing documents: Doc 05, Doc 20 §2/§15, Doc 24 P7 · Prior: [PHASE_6_IMPLEMENTATION_REPORT.md](PHASE_6_IMPLEMENTATION_REPORT.md)

## 1. Executive Summary

KEEL's flagship ecosystem now has deep determinism: Node probes run with a **virtual clock**, **seeded randomness**, **stabilized TZ/locale/NODE_ENV**, and **intercepted fetch** — so code using `Date.now`, `Math.random`, and network calls seals through the determinism gate instead of flapping. All three playbook acceptance criteria are proven end-to-end through the *unchanged* oracle: the deep fixture passes the ×5 verification gate; an added network call surfaces as `unrecorded-effect`; replay against a Phase-2-era environment yields a graceful `stale-baseline` naming `interceptorVersions`.

## 2. Architecture Compliance

The runner is a **pure planner** (Doc 20 §2/§15): it materializes the embedded preload shim as a `SpawnPlan` file (the exact mechanism planned files exist for), injects env, and declares armed versions — the engine kept every dangerous responsibility. **Recorded rulings:** (1) determinism defaults are *derived* (fixed 2000-01-01 epoch; FNV-1a(argv) seed) rather than stored per-baseline — Doc 06's "replay arms the baseline epoch/seed" holds trivially since both sides derive identically, and `interceptorConfig` remains the override seam; (2) three touches outside the playbook's path list were required by the phase mandate that existing flows keep working: the normalizer maps side-channel net calls into the model's *existing* `net-call` observations (URLs scrubbed like any value), `CheckService` derives `currentInterceptorVersions` via the new `engine.capabilitiesOf` (capability reporting is the registry's Doc 20 §2 contract — without this every node baseline would go falsely stale), and both composition roots register the runner; (3) `network:'forbidden'` is now *enforced* on this runner, upgrading Phase 4's documented declarative reading for the command runner. Risk rule honored: the shim uses documented Node APIs only (globals, `require.cache`, `process.on('exit')`, env).

## 3–4. Node Runner & Interceptors

`NodeRunner.plan()`: preload file + `NODE_OPTIONS=--require ./keel-node-preload.cjs` (appending to any existing NODE_OPTIONS) + `TZ=UTC`/`C.UTF-8`/`NODE_ENV` default + per-interceptor env + `sideChannel: true`. Interceptors, versions in fingerprints (`node-clock/1`, `node-rng/1`, `node-net/1` — bumping one honestly invalidates baselines): virtual `Date`/`Date.now`/`performance.now` via Proxy, advancing 1ms per call (duration math stays finite, still deterministic); mulberry32 `Math.random`; fetch in `record` (real call, sha-256 metadata over the channel), `stub` (recordings file via `interceptorConfig.networkRecordingsPath`), `forbidden` (rejects, emits a blocked net-call event). **Tamper detection:** exit-time identity checks on `globalThis.Date`/`Math.random` plus Proxy set-trap recording of `Date.now` reassignment *attempts* — the e2e caught the original check testing the wrong thing (the Proxy silently absorbs reassignment; determinism held but the attempt was invisible — now it's a finding either way).

## 5–6. Side Channel & Fingerprint

Protocol v1: NDJSON on fd 3 (extra libuv pipe — engine opens it only when the plan asks; 8 MiB ceiling outside the output caps), versioned messages (`v:1`), tolerant parsing (unknown kinds/versions skipped — the backward-compat rule). Messages: interceptor-armed events, per-call `net-call`, exit-time `interceptor-report` (armed versions, tamper findings, CJS module graph via `require.cache` — the P12 feed). Armed versions flow into `EnvironmentFingerprint.interceptorVersions` exactly as Doc 05 requires, and the ADR-012 strict policy now has real teeth: the P2-era-replay test proves version drift → `stale-baseline`.

## 7–9. Files & Dependency Compliance

**Added:** `execution/runners/node/` (preload-source, node-runner, README), `execution/side-channel.ts`, engine/oracle e2e suites (16 tests). **Modified:** runner-sdk (`SpawnPlan.sideChannel`, additive), process-control (fd-3 collection), engine (parse + additive `ExecutionResult.sideChannel`, `capabilitiesOf`), probe-plan (network policy through `interceptorConfig`), normalizer (net-call mapping), check-service (version derivation), both composition roots, execution index. depcruise: **0 violations** (151 modules / 672 edges); the node-runner submodule proven covered by `execution-is-isolated` via injection.

## 10–11. Verification & CI

Exit-code-asserted locally (the Phase 6 lesson, institutionalized): lint 0 · depcruise 0 · typecheck 0 · build 0 · **269/269 tests** · dogfood green. CI: full success on `24b83da` — the deep-runner e2e (virtual clock identity across runs, tamper, module graph, all three network modes with a live local server) and the oracle acceptance suite ran on all six matrix jobs.

## 12–14. Performance / Security / Cross-platform

Preload cost is one file materialization + interceptor arming per execution (~ms); the ×5 deep-fixture gate runs in seconds. Security: the shim is an engine-shipped asset, never user-supplied; response *bodies* never cross the side channel (hashes only); recordings files are caller-provided paths; URLs pass through the normalizer's scrub rules so secrets in query strings are caught. Cross-platform: fd-3 pipes, relative `--require`, and the HTTP fixtures verified on Linux/macOS/Windows × Node 22/24.

## 15. Known Limitations (documented futures)

(1) Network interception covers `fetch` only — `http`/`https` module clients later; code using them on the node runner behaves like the command runner did. (2) Module graph is CJS-only (`require.cache`); ESM via `module.register` when P12 needs it. (3) Automatic record→stub round-trip through baseline storage awaits replay-conditions plumbing — stub mode works today from a provided recordings file. (4) Timers are not virtualized (`setTimeout` waits real time); the clock interceptors cover *reads* of time. (5) `performance.now` returns a bare counter — adequate for determinism, wrong for real profiling (probes shouldn't profile).

## 16. Lessons Learned

The tamper test failed for the best possible reason: the defense (Proxy) was stronger than the detector, making the check unfalsifiable — the same "unfalsifiable check" bug class as Phase 5's interceptor-versions slip, now caught pre-commit. Deriving determinism inputs instead of storing them eliminated an entire conditions-plumbing subsystem; worth remembering when P9 needs classification evidence: prefer recomputable over persisted where identical by construction.

## 17. Readiness for Phase 8

Heuristic classification (classify/ rule registry, annotations facts-first persistence — `withAnnotations`/`attachAnnotations` already exist and are tested, `keel suppress` CLI equivalent, eval corpus v0 with two-maintainer labeling, the AI-deletable CI job). No architectural changes required; the `annotations: []` field on every persisted verdict has been waiting since Phase 5.

## 18. Independent Engineering Audit

**Google:** derived-not-stored determinism is the standout decision — less state, same guarantee; flags that per-call clock advance means call-count changes surface as timestamp diffs — correct behavior (call-count *is* behavior), documented. **Microsoft:** fd-3 on Windows via libuv verified in CI, the platform risk retired; NODE_OPTIONS append (not replace) preserves user flags. **HashiCorp:** interceptor versions in fingerprints turn shim upgrades into honest baseline invalidations — exactly the versioning discipline the constitution demands; the embedded-shim-as-string is pragmatic and correctly versioned. **JetBrains:** the Proxy-based Date keeps `instanceof Date` and statics working — the compatibility trap avoided; suggests documenting timer non-virtualization prominently for probe authors — done (runner README, §15). **No blocking findings.**

**Phase 7 is complete:** every responsibility implemented, existing systems unchanged (all prior suites green untouched), deterministic metadata proven, interceptor versioning live in fingerprints and policy, the side channel verified cross-platform, dogfood and the full CI matrix green.
