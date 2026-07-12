# KEEL — Storage Design

> Document 08 · Status: FROZEN — Architecture v1.0 (2026-07-12)

## 1. Layout: SQLite index + Content-Addressed Store (hybrid)

```
<repo>/.keel/
├── keel.db              # SQLite: metadata, relations, queries
├── objects/ab/cdef…     # CAS: canonical payloads, sharded by hash prefix
├── logs/
└── tmp/                 # staging for atomic writes
```

**Why hybrid (vs everything-in-SQLite):** snapshots and recordings are large, immutable, content-hashed blobs — CAS gives free dedup (unchanged probe outputs across baselines store once), atomic writes via rename, human inspectability (`keel show <hash>`), and keeps the DB small and fast. SQLite holds what needs *querying*: relations, provenance, status. This is git's proven layout for the same problem shape. **Why not everything-in-files:** verdict queries ("divergences for probe X across last 5 runs") want SQL; hand-rolling indexes over JSON files is SQLite with extra steps. The `.keel/` directory is designed to be git-committable (deterministic content, no absolute paths, machine-specific bits confined to `keel.db` local tables) even though sharing isn't advertised in v1.

**Location (frozen):** default `<worktree-root>/.keel/` — one store per git worktree, so parallel worktrees never share mutable state. `KEEL_STORE_DIR` relocates the store out-of-tree (corporate file-sync/AV environments — freeze amendment per platform review); the store path never participates in any content hash.

## 2. Schema (conceptual — tables and key columns)

| Table | Key columns | Notes |
|-------|-------------|-------|
| `meta` | schema_version, keel_version | migration anchor |
| `baselines` | id, label, status, sealed_at, config_hash, env_fingerprint (json), git_commit, git_dirty, ruleset_version | |
| `baseline_snapshots` | baseline_id, probe_name, snapshot_object, probe_spec_hash | FK cascade |
| `check_runs` | id, baseline_id, started_at, status, code_diff_object, timing (json) | |
| `verdicts` | check_run_id, status, verdict_object | full document in CAS; row for queries |
| `divergences` | check_run_id, stable_id, probe_name, kind, path, baseline_ref, candidate_ref | indexed on (stable_id), (check_run_id) |
| `annotations` | divergence_stable_id, check_run_id, label, confidence, tier, template_version, model_id, evidence_hash | append-only |
| `suppressions` | stable_id_or_pattern, reason, created_at, expiry | |
| `objects_refs` | object_hash, kind, size | optional accounting for GC (authoritative refcount computed by scan) |

Pragmas: WAL mode (concurrent read during check), `foreign_keys=ON`, `synchronous=NORMAL` (WAL-safe). One writer at a time enforced by an advisory lock file — concurrent `keel check` in the same repo queues rather than corrupts.

## 3. Repositories

Per-consumer interfaces (ISP): `BaselineRepository` (create-capturing, seal, resolve-latest, retire), `VerdictRepository` (persist-facts, append-annotations, query), `SuppressionRepository`, `ObjectStore` (put/get/has by hash). Implementations live in `storage/`; ports live with consumers (DIP). Driver: `better-sqlite3` (synchronous API is *right* for this workload — single-writer, short transactions, no callback plumbing; wrapped so the choice is swappable).

## 4. Caching

Deliberately minimal (KISS): CAS **is** the cache (content addressing = perfect invalidation); an in-process LRU for hot objects during a check (baseline snapshots read once per probe); no cross-process cache daemon, ever. The one true cache opportunity — "skip replay if nothing relevant changed" — is an *engine* feature (probe→file dependency mapping, roadmap Phase 12), not a storage feature.

## 5. Migration & Versioning

- Forward-only, numbered SQL migrations applied on open inside a transaction; `meta.schema_version` gates. Downgrade = restore from the pre-migration backup KEEL writes automatically before migrating (`keel.db.bak-<version>`), documented.
- CAS objects are never migrated in place: object schema version is inside the canonical payload; readers handle N and N-1, older objects surface as `retired` baselines. Rewriting hashed content would forge history — the store's integrity claim is that a hash you saw once means the same bytes forever.
- Integrity: `keel doctor` verifies CAS hashes and FK consistency; corruption → quarantine object, retire dependents, report.
