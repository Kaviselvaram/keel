/**
 * Baseline persistence (Doc 20 §8). Methods are domain operations, not CRUD
 * (Doc 23). Only terminal baselines (sealed/rejected) are persisted —
 * capture is atomic (Doc 03 §3.9); a 'capturing' baseline is in-memory
 * state, and persisting one would be a caller bug.
 */

import { invariant, IntegrityError } from '../../shared/index.js';
import type { Clock } from '../../shared/index.js';
import { assertSupportedSchemaVersion } from '../../model/index.js';
import type { Baseline, ContentHash, EntityId } from '../../model/index.js';
import type { SqliteDatabase } from '../database.js';
import type { DocumentStore } from '../document-store.js';

export interface BaselineSummary {
  readonly id: EntityId;
  readonly label: string;
  readonly status: 'sealed' | 'rejected';
  readonly sealedAtEpochMs: number | null;
}

interface BaselineRow {
  id: string;
  label: string;
  status: 'sealed' | 'rejected';
  sealed_at: number | null;
  doc_hash: string;
}

export class SqliteBaselineRepository {
  private readonly db: SqliteDatabase;
  private readonly documents: DocumentStore;
  private readonly clock: Clock;

  constructor(db: SqliteDatabase, documents: DocumentStore, clock: Clock) {
    this.db = db;
    this.documents = documents;
    this.clock = clock;
  }

  /** Persists a terminal baseline in one transaction. Idempotent for identical content; conflicting re-save is corruption. */
  async save(baseline: Baseline): Promise<void> {
    invariant(
      baseline.status === 'sealed' || baseline.status === 'rejected',
      'only terminal baselines are persisted (capture is atomic)',
      { id: baseline.id, status: baseline.status },
    );
    const docHash = await this.documents.putDocument(baseline, Object.values(baseline.snapshots));

    const existing = this.db
      .prepare('SELECT doc_hash FROM baselines WHERE id = ?')
      .get(baseline.id) as { doc_hash: string } | undefined;
    if (existing !== undefined) {
      if (existing.doc_hash === docHash) return; // idempotent retry
      throw new IntegrityError('baseline id already exists with different content', {
        code: 'KEEL_E_STORE_ID_CONFLICT',
        context: { id: baseline.id },
      });
    }

    const insertBaseline = this.db.prepare(
      `INSERT INTO baselines (id, label, status, sealed_at, doc_hash, schema_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertSnapshot = this.db.prepare(
      'INSERT INTO baseline_snapshots (baseline_id, probe_name, snapshot_hash) VALUES (?, ?, ?)',
    );
    const write = this.db.transaction(() => {
      insertBaseline.run(
        baseline.id,
        baseline.label,
        baseline.status,
        baseline.sealedAtEpochMs,
        docHash,
        baseline.schemaVersion,
        this.clock.epochMillis(),
      );
      for (const [probeName, snapshotHash] of Object.entries(baseline.snapshots)) {
        insertSnapshot.run(baseline.id, probeName, snapshotHash);
      }
    });
    write();
  }

  async getById(id: EntityId): Promise<Baseline | undefined> {
    const row = this.db
      .prepare('SELECT id, label, status, sealed_at, doc_hash FROM baselines WHERE id = ?')
      .get(id) as BaselineRow | undefined;
    if (row === undefined) return undefined;
    const document = (await this.documents.getDocument(row.doc_hash)) as Baseline;
    assertSupportedSchemaVersion(document.schemaVersion);
    return document;
  }

  /** ADR-012: baseline resolution — latest sealed baseline for a label. */
  async latestSealedByLabel(label: string): Promise<Baseline | undefined> {
    const row = this.db
      .prepare(
        `SELECT id FROM baselines WHERE label = ? AND status = 'sealed'
         ORDER BY sealed_at DESC LIMIT 1`,
      )
      .get(label) as { id: string } | undefined;
    return row === undefined ? undefined : this.getById(row.id);
  }

  /** Lazy listing — no document loads (Doc 24 P3 performance). */
  list(): readonly BaselineSummary[] {
    const rows = this.db
      .prepare('SELECT id, label, status, sealed_at FROM baselines ORDER BY created_at DESC')
      .all() as BaselineRow[];
    return rows.map((row) => ({
      id: row.id,
      label: row.label,
      status: row.status,
      sealedAtEpochMs: row.sealed_at,
    }));
  }

  snapshotHashes(id: EntityId): Readonly<Record<string, ContentHash>> {
    const rows = this.db
      .prepare('SELECT probe_name, snapshot_hash FROM baseline_snapshots WHERE baseline_id = ?')
      .all(id) as { probe_name: string; snapshot_hash: string }[];
    return Object.fromEntries(rows.map((row) => [row.probe_name, row.snapshot_hash]));
  }

  /** Admin removal: index rows only; objects become GC-collectable garbage. */
  remove(id: EntityId): boolean {
    return this.db.prepare('DELETE FROM baselines WHERE id = ?').run(id).changes > 0;
  }
}
