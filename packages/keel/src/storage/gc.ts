/**
 * Garbage-collection foundation (Doc 20 §8, Doc 24 P3: skeleton only).
 * Reachability from index roots over the explicit object_refs edges — no
 * document parsing. Nothing runs implicitly (C39): collection is an explicit
 * call, dry-run by default.
 */

import { chmod, readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { ContentHash } from '../model/index.js';
import type { Logger } from '../observability/index.js';
import type { SqliteDatabase } from './database.js';

export interface GcReport {
  readonly totalObjects: number;
  readonly reachable: number;
  readonly dangling: readonly ContentHash[];
  readonly danglingBytes: number;
  readonly staleTempFiles: readonly string[];
  readonly applied: boolean;
}

const ROOT_QUERIES = [
  'SELECT doc_hash AS hash FROM baselines',
  'SELECT snapshot_hash AS hash FROM baseline_snapshots',
  'SELECT doc_hash AS hash FROM check_runs',
  'SELECT facts_doc_hash AS hash FROM verdicts',
  'SELECT annotated_doc_hash AS hash FROM verdicts WHERE annotated_doc_hash IS NOT NULL',
  'SELECT doc_hash AS hash FROM suppressions',
  'SELECT hash FROM objects WHERE pinned = 1',
];

/** BFS over object_refs from every index-declared root (plus pins). */
export function computeReachable(db: SqliteDatabase): ReadonlySet<ContentHash> {
  const reachable = new Set<ContentHash>();
  const queue: ContentHash[] = [];
  for (const sql of ROOT_QUERIES) {
    for (const row of db.prepare(sql).all() as { hash: string }[]) {
      if (!reachable.has(row.hash)) {
        reachable.add(row.hash);
        queue.push(row.hash);
      }
    }
  }
  const edges = db.prepare('SELECT to_hash FROM object_refs WHERE from_hash = ?');
  while (queue.length > 0) {
    const current = queue.pop() as ContentHash;
    for (const row of edges.all(current) as { to_hash: string }[]) {
      if (!reachable.has(row.to_hash)) {
        reachable.add(row.to_hash);
        queue.push(row.to_hash);
      }
    }
  }
  return reachable;
}

export interface CollectOptions {
  readonly db: SqliteDatabase;
  readonly directory: string;
  readonly logger: Logger;
  /** Default false: report only. True deletes dangling rows+files and stale temps. */
  readonly apply?: boolean;
  /** Temp files younger than this are potentially live writes and are never touched. */
  readonly tempGraceMs?: number;
  readonly nowEpochMs: number;
}

export async function collectGarbage(options: CollectOptions): Promise<GcReport> {
  const reachable = computeReachable(options.db);
  const all = options.db.prepare('SELECT hash, size FROM objects').all() as {
    hash: string;
    size: number;
  }[];
  const dangling = all.filter((row) => !reachable.has(row.hash));
  const danglingBytes = dangling.reduce((sum, row) => sum + row.size, 0);

  const tmpDir = path.join(options.directory, 'tmp');
  const grace = options.tempGraceMs ?? 60 * 60 * 1000;
  const staleTempFiles: string[] = [];
  for (const name of await readdir(tmpDir).catch(() => [] as string[])) {
    const file = path.join(tmpDir, name);
    const info = await stat(file).catch(() => undefined);
    if (info !== undefined && options.nowEpochMs - info.mtimeMs > grace) {
      staleTempFiles.push(file);
    }
  }

  const apply = options.apply === true;
  if (apply) {
    const deleteRefs = options.db.prepare('DELETE FROM object_refs WHERE from_hash = ?');
    const deleteRow = options.db.prepare('DELETE FROM objects WHERE hash = ?');
    for (const row of dangling) {
      options.db.transaction(() => {
        deleteRefs.run(row.hash);
        deleteRow.run(row.hash);
      })();
      const file = path.join(options.directory, 'objects', row.hash.slice(0, 2), row.hash.slice(2));
      await chmod(file, 0o600).catch(() => undefined);
      await unlink(file).catch(() => undefined);
    }
    for (const file of staleTempFiles) {
      await unlink(file).catch(() => undefined);
    }
    options.logger.info('storage.gc.applied', {
      removed: dangling.length,
      bytes: danglingBytes,
      staleTemps: staleTempFiles.length,
    });
  }

  return {
    totalObjects: all.length,
    reachable: reachable.size,
    dangling: dangling.map((row) => row.hash),
    danglingBytes,
    staleTempFiles,
    applied: apply,
  };
}
