# Node Deep Runner

Design: [Doc 05](../../../../../../docs/architecture/05-execution-engine.md) · Playbook: [Doc 24 P7](../../../../../../docs/architecture/24-implementation-playbooks.md)

A pure planner (Doc 20 §2): materializes the embedded preload shim as a workspace file, injects `NODE_OPTIONS=--require`, stabilizes the environment (TZ=UTC, C.UTF-8 locale, NODE_ENV defaulted), and requests the fd-3 side channel. The engine keeps owning spawn/kill/caps.

**Interceptors** (versions participate in fingerprints; changing one honestly invalidates baselines): `node-clock/1` — virtual `Date`/`Date.now`/`performance.now` from a fixed epoch (2000-01-01T00:00:00Z), advancing 1ms per call; `node-rng/1` — mulberry32-seeded `Math.random`; `node-net/1` — patched `fetch` in `record` (real call, hashed metadata over the side channel → `net-call` observations), `stub` (served from a recordings file), or `forbidden` (rejects — enforced here, unlike the command runner's declarative reading). **Determinism defaults are derived, not stored** (recorded ruling): fixed epoch constant + FNV-1a(argv) seed — capture and replay compute identical values; `interceptorConfig` overrides both (`clockEpochMs`, `rngSeed`, `networkMode`, `networkRecordingsPath`).

**Side channel** (protocol v1, NDJSON on fd 3): `net-call` events + an exit-time `interceptor-report` carrying armed versions, tamper findings (identity checks on `globalThis.Date`/`Math.random`, plus recorded `Date.now` reassignment attempts — determinism holds either way, attempts are visible), and the CJS module graph (`require.cache`, the documented API — feeds Phase 12's diff-scoping).

**Known v1 limits** (documented futures, not gaps): fetch-only network interception (`http`/`https` module clients later); CJS-only module graph (ESM via `module.register` later); automatic record→stub round-trip through baseline storage awaits the replay-conditions plumbing; timers (`setTimeout`) are not virtualized.
