/**
 * Store integrity verification (Doc 20 §8): SQLite self-check, full object
 * re-hash, broken-reference detection, dangling listing. Corrupt objects are
 * quarantined by the read path — this report aggregates; it never repairs
 * (C33).
 */

import { IntegrityError } from '../shared/index.js';
import type { ContentHash } from '../model/index.js';
import type { SqliteDatabase } from './database.js';
import { sqliteIntegrityCheck } from './database.js';
import { computeReachable } from './gc.js';
import type { ObjectStore } from './object-store.js';

export interface IntegrityReport {
  readonly ok: boolean;
  readonly sqlite: { readonly ok: boolean; readonly findings: readonly string[] };
  readonly objects: {
    readonly total: number;
    readonly verified: number;
    readonly corrupt: readonly ContentHash[];
    readonly missingFiles: readonly ContentHash[];
  };
  readonly danglingObjects: readonly ContentHash[];
}

export async function verifyStoreIntegrity(
  db: SqliteDatabase,
  objects: ObjectStore,
): Promise<IntegrityReport> {
  const sqlite = sqliteIntegrityCheck(db);

  const corrupt: ContentHash[] = [];
  const missingFiles: ContentHash[] = [];
  let verified = 0;
  const hashes = objects.listHashes();
  for (const hash of hashes) {
    try {
      // Streaming read verifies without holding the object in memory.
      for await (const _chunk of objects.getStream(hash)) {
        // draining is the verification
      }
      verified += 1;
    } catch (error) {
      if (error instanceof IntegrityError) {
        if (error.code === 'KEEL_E_STORE_OBJECT_FILE_MISSING') missingFiles.push(hash);
        else corrupt.push(hash);
      } else {
        const missing = (error as { code?: string }).code === 'ENOENT';
        (missing ? missingFiles : corrupt).push(hash);
      }
    }
  }

  const reachable = computeReachable(db);
  const dangling = hashes.filter((hash) => !reachable.has(hash));

  return {
    ok: sqlite.ok && corrupt.length === 0 && missingFiles.length === 0,
    sqlite,
    objects: { total: hashes.length, verified, corrupt, missingFiles },
    danglingObjects: dangling,
  };
}
