/**
 * Typed canonical documents over the CAS (Doc 08). Storage does not
 * understand what it stores — a document is canonical bytes plus explicitly
 * declared outgoing references. The refs feed GC reachability without ever
 * parsing JSON (schema-blind by design).
 */

import { EnvironmentError, IntegrityError } from '../shared/index.js';
import { canonicalBytes, isContentHash } from '../model/index.js';
import type { ContentHash } from '../model/index.js';
import type { SqliteDatabase } from './database.js';
import type { ObjectStore } from './object-store.js';

export class DocumentStore {
  private readonly db: SqliteDatabase;
  private readonly objects: ObjectStore;

  constructor(db: SqliteDatabase, objects: ObjectStore) {
    this.db = db;
    this.objects = objects;
  }

  /**
   * Persists a document; `refs` are the object hashes this document points
   * at (reference validation: every ref must already exist — the caller
   * stores leaves before documents, exactly like git).
   */
  async putDocument(value: unknown, refs: readonly ContentHash[] = []): Promise<ContentHash> {
    for (const ref of refs) {
      if (!isContentHash(ref) || !this.objects.has(ref)) {
        throw new IntegrityError('document references a missing object', {
          code: 'KEEL_E_STORE_MISSING_REFERENT',
          context: { ref },
        });
      }
    }
    const { hash } = await this.objects.put(canonicalBytes(value));
    const insert = this.db.prepare(
      'INSERT OR IGNORE INTO object_refs (from_hash, to_hash) VALUES (?, ?)',
    );
    const record = this.db.transaction((edges: readonly ContentHash[]) => {
      for (const ref of edges) insert.run(hash, ref);
    });
    record(refs);
    return hash;
  }

  /** Reads and parses a document. Content integrity is verified by the CAS read. */
  async getDocument(hash: ContentHash): Promise<unknown> {
    const bytes = await this.objects.get(hash);
    try {
      return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    } catch (cause) {
      throw new EnvironmentError('object is not a JSON document', {
        code: 'KEEL_E_STORE_NOT_A_DOCUMENT',
        context: { hash },
        cause,
      });
    }
  }
}
