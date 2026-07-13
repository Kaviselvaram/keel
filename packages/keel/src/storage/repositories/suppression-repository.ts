/**
 * Suppression persistence (Doc 20 §8, ADR-014). Status changes are declared
 * transitions guarded at the SQL level: the model validates transition
 * legality; the repository guards cross-process races (optimistic
 * WHERE status = 'active').
 */

import { IntegrityError } from '../../shared/index.js';
import type { Clock } from '../../shared/index.js';
import { assertSupportedSchemaVersion } from '../../model/index.js';
import type { EntityId, Suppression, SuppressionStatus } from '../../model/index.js';
import type { SqliteDatabase } from '../database.js';
import type { DocumentStore } from '../document-store.js';

export class SqliteSuppressionRepository {
  private readonly db: SqliteDatabase;
  private readonly documents: DocumentStore;
  private readonly clock: Clock;

  constructor(db: SqliteDatabase, documents: DocumentStore, clock: Clock) {
    this.db = db;
    this.documents = documents;
    this.clock = clock;
  }

  async save(suppression: Suppression): Promise<void> {
    const docHash = await this.documents.putDocument(suppression);
    const target =
      suppression.target.kind === 'stable-id'
        ? { kind: 'stable-id', value: suppression.target.stableId }
        : { kind: 'pattern', value: suppression.target.pattern };
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO suppressions (id, status, target_kind, target_value, doc_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(suppression.id, suppression.status, target.kind, target.value, docHash, this.clock.epochMillis());
    if (result.changes === 0) {
      const existing = this.db
        .prepare('SELECT doc_hash FROM suppressions WHERE id = ?')
        .get(suppression.id) as { doc_hash: string } | undefined;
      if (existing?.doc_hash !== docHash) {
        throw new IntegrityError('suppression id already exists with different content', {
          code: 'KEEL_E_STORE_ID_CONFLICT',
          context: { id: suppression.id },
        });
      }
    }
  }

  /**
   * Persists an active→(absorbed|expired) transition produced by the model.
   * The optimistic guard makes concurrent transitions lose loudly, never
   * silently.
   */
  async transition(updated: Suppression): Promise<void> {
    const docHash = await this.documents.putDocument(updated);
    const result = this.db
      .prepare(`UPDATE suppressions SET status = ?, doc_hash = ? WHERE id = ? AND status = 'active'`)
      .run(updated.status, docHash, updated.id);
    if (result.changes === 0) {
      throw new IntegrityError('suppression is missing or no longer active', {
        code: 'KEEL_E_STORE_TRANSITION_CONFLICT',
        context: { id: updated.id, to: updated.status },
      });
    }
  }

  async getById(id: EntityId): Promise<Suppression | undefined> {
    const row = this.db.prepare('SELECT doc_hash FROM suppressions WHERE id = ?').get(id) as
      | { doc_hash: string }
      | undefined;
    if (row === undefined) return undefined;
    const document = (await this.documents.getDocument(row.doc_hash)) as Suppression;
    assertSupportedSchemaVersion(document.schemaVersion);
    return document;
  }

  async listByStatus(status: SuppressionStatus): Promise<readonly Suppression[]> {
    const rows = this.db
      .prepare('SELECT doc_hash FROM suppressions WHERE status = ? ORDER BY created_at')
      .all(status) as { doc_hash: string }[];
    const results: Suppression[] = [];
    for (const row of rows) {
      const document = (await this.documents.getDocument(row.doc_hash)) as Suppression;
      assertSupportedSchemaVersion(document.schemaVersion);
      results.push(document);
    }
    return results;
  }
}
