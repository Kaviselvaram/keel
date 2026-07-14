/**
 * Verdict + CheckRun persistence (Doc 20 §8).
 *
 * Structurally encodes facts-before-annotations (C11): `saveVerdict` refuses
 * annotated verdicts; `attachAnnotations` is the one-shot second step, an
 * append in the CAS plus a guarded, declared column transition. A crash
 * between the two loses advice, never truth.
 */

import { invariant, IntegrityError } from '../../shared/index.js';
import type { Clock } from '../../shared/index.js';
import { assertSupportedSchemaVersion } from '../../model/index.js';
import type { CheckRun, ContentHash, EntityId, Verdict } from '../../model/index.js';
import type { SqliteDatabase } from '../database.js';
import type { DocumentStore } from '../document-store.js';

export interface VerdictSummary {
  readonly id: EntityId;
  readonly baselineId: EntityId;
  readonly status: Verdict['status'];
  readonly annotated: boolean;
}

export class SqliteVerdictRepository {
  private readonly db: SqliteDatabase;
  private readonly documents: DocumentStore;
  private readonly clock: Clock;

  constructor(db: SqliteDatabase, documents: DocumentStore, clock: Clock) {
    this.db = db;
    this.documents = documents;
    this.clock = clock;
  }

  async saveCheckRun(run: CheckRun): Promise<void> {
    const docHash = await this.documents.putDocument(run);
    this.db
      .prepare('INSERT OR IGNORE INTO check_runs (id, baseline_id, started_at, doc_hash) VALUES (?, ?, ?, ?)')
      .run(run.id, run.baselineId, run.startedAtEpochMs, docHash);
  }

  /** Persists the deterministic facts (C11: annotations must be empty here). */
  async saveVerdict(verdict: Verdict): Promise<void> {
    invariant(
      verdict.annotations.length === 0,
      'facts are persisted before annotations (C11) — use attachAnnotations for the advisory step',
      { id: verdict.id },
    );
    const refs: ContentHash[] = Object.values(verdict.replaySnapshots);
    if (verdict.codeDiffRef !== null) refs.push(verdict.codeDiffRef);
    const docHash = await this.documents.putDocument(verdict, refs);

    const existing = this.db
      .prepare('SELECT facts_doc_hash FROM verdicts WHERE id = ?')
      .get(verdict.id) as { facts_doc_hash: string } | undefined;
    if (existing !== undefined) {
      if (existing.facts_doc_hash === docHash) return; // idempotent retry
      throw new IntegrityError('verdict id already exists with different facts', {
        code: 'KEEL_E_STORE_ID_CONFLICT',
        context: { id: verdict.id },
      });
    }
    this.db
      .prepare(
        `INSERT INTO verdicts (id, check_run_id, baseline_id, status, facts_doc_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        verdict.id,
        verdict.checkRunId,
        verdict.baselineId,
        verdict.status,
        docHash,
        this.clock.epochMillis(),
      );
  }

  /** One-shot advisory step: stores the annotated document and transitions the column under guard. */
  async attachAnnotations(annotated: Verdict): Promise<void> {
    invariant(annotated.annotations.length > 0, 'attachAnnotations requires annotations', {
      id: annotated.id,
    });
    const docHash = await this.documents.putDocument(annotated);
    const result = this.db
      .prepare('UPDATE verdicts SET annotated_doc_hash = ? WHERE id = ? AND annotated_doc_hash IS NULL')
      .run(docHash, annotated.id);
    if (result.changes === 0) {
      throw new IntegrityError('verdict is missing or already annotated (annotation is one-shot)', {
        code: 'KEEL_E_STORE_TRANSITION_CONFLICT',
        context: { id: annotated.id },
      });
    }
  }

  /** Returns the annotated document when present, otherwise the facts (both are complete verdicts). */
  async getById(id: EntityId): Promise<Verdict | undefined> {
    const row = this.db
      .prepare('SELECT facts_doc_hash, annotated_doc_hash FROM verdicts WHERE id = ?')
      .get(id) as { facts_doc_hash: string; annotated_doc_hash: string | null } | undefined;
    if (row === undefined) return undefined;
    const document = (await this.documents.getDocument(
      row.annotated_doc_hash ?? row.facts_doc_hash,
    )) as Verdict;
    assertSupportedSchemaVersion(document.schemaVersion);
    return document;
  }

  /** Most recent verdict ids, newest first (keel_explain's default search space). */
  listRecentIds(limit: number): readonly EntityId[] {
    return (
      this.db
        .prepare('SELECT id FROM verdicts ORDER BY created_at DESC, id DESC LIMIT ?')
        .all(limit) as { id: string }[]
    ).map((row) => row.id);
  }

  listByBaseline(baselineId: EntityId): readonly VerdictSummary[] {
    const rows = this.db
      .prepare(
        `SELECT id, baseline_id, status, annotated_doc_hash FROM verdicts
         WHERE baseline_id = ? ORDER BY created_at DESC`,
      )
      .all(baselineId) as {
      id: string;
      baseline_id: string;
      status: Verdict['status'];
      annotated_doc_hash: string | null;
    }[];
    return rows.map((row) => ({
      id: row.id,
      baselineId: row.baseline_id,
      status: row.status,
      annotated: row.annotated_doc_hash !== null,
    }));
  }
}
