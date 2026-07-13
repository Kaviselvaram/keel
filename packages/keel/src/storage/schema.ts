/**
 * Store schema v1 (Doc 08). Design rules:
 *  - Full entities live as canonical documents in the CAS; rows carry only
 *    queryable columns plus the document hash. The index is the source of
 *    reachability (Doc 02 §8) — an object without rows is garbage, never
 *    corruption.
 *  - Immutability (C32): the only UPDATE statements in the whole module are
 *    the declared status transitions (suppressions.status/doc_hash,
 *    verdicts.annotated_doc_hash, objects.pinned).
 *  - `object_refs` records document→object edges explicitly at write time,
 *    so GC reachability never parses JSON.
 */

import type { Migration } from './migrations.js';

export const SCHEMA_MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'initial-store-schema',
    up(db) {
      db.exec(`
        CREATE TABLE meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        ) WITHOUT ROWID;

        CREATE TABLE objects (
          hash TEXT PRIMARY KEY CHECK (length(hash) = 64),
          size INTEGER NOT NULL CHECK (size >= 0),
          stored_size INTEGER NOT NULL CHECK (stored_size >= 0),
          encoding TEXT NOT NULL CHECK (encoding IN ('gzip', 'raw')),
          pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
          created_at INTEGER NOT NULL
        ) WITHOUT ROWID;

        CREATE TABLE object_refs (
          from_hash TEXT NOT NULL REFERENCES objects(hash),
          to_hash TEXT NOT NULL REFERENCES objects(hash),
          PRIMARY KEY (from_hash, to_hash)
        ) WITHOUT ROWID;
        CREATE INDEX idx_object_refs_to ON object_refs(to_hash);

        CREATE TABLE baselines (
          id TEXT PRIMARY KEY,
          label TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('sealed', 'rejected')),
          sealed_at INTEGER,
          doc_hash TEXT NOT NULL REFERENCES objects(hash),
          schema_version INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX idx_baselines_label ON baselines(label, status, sealed_at DESC);

        CREATE TABLE baseline_snapshots (
          baseline_id TEXT NOT NULL REFERENCES baselines(id) ON DELETE CASCADE,
          probe_name TEXT NOT NULL,
          snapshot_hash TEXT NOT NULL REFERENCES objects(hash),
          PRIMARY KEY (baseline_id, probe_name)
        ) WITHOUT ROWID;

        CREATE TABLE check_runs (
          id TEXT PRIMARY KEY,
          baseline_id TEXT NOT NULL,
          started_at INTEGER NOT NULL,
          doc_hash TEXT NOT NULL REFERENCES objects(hash)
        );

        CREATE TABLE verdicts (
          id TEXT PRIMARY KEY,
          check_run_id TEXT NOT NULL,
          baseline_id TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('clean', 'diverged', 'stale-baseline', 'error')),
          facts_doc_hash TEXT NOT NULL REFERENCES objects(hash),
          annotated_doc_hash TEXT REFERENCES objects(hash),
          created_at INTEGER NOT NULL
        );
        CREATE INDEX idx_verdicts_baseline ON verdicts(baseline_id, created_at DESC);

        CREATE TABLE suppressions (
          id TEXT PRIMARY KEY,
          status TEXT NOT NULL CHECK (status IN ('active', 'absorbed', 'expired')),
          target_kind TEXT NOT NULL CHECK (target_kind IN ('stable-id', 'pattern')),
          target_value TEXT NOT NULL,
          doc_hash TEXT NOT NULL REFERENCES objects(hash),
          created_at INTEGER NOT NULL
        );
        CREATE INDEX idx_suppressions_status ON suppressions(status);
      `);
    },
  },
];
