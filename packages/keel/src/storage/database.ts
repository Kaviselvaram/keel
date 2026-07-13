/**
 * SQLite handle (Doc 20 §8 internal). The only file in KEEL that constructs
 * a better-sqlite3 Database (C36 — additionally machine-enforced by the
 * `sqlite-only-in-storage` dependency rule).
 *
 * Durability posture: WAL journal + synchronous=NORMAL — crash-consistent
 * against process death (the kill -9 matrix); a committed transaction may be
 * lost to whole-OS power failure but never torn. FULL was rejected as a
 * per-write fsync tax that defends against a failure mode (power loss)
 * outside the stated crash model (Doc 08).
 */

import Database from 'better-sqlite3';
import { EnvironmentError } from '../shared/index.js';

export type SqliteDatabase = Database.Database;

export function openDatabase(file: string): SqliteDatabase {
  let db: SqliteDatabase;
  try {
    db = new Database(file);
  } catch (cause) {
    throw new EnvironmentError('cannot open store database', {
      code: 'KEEL_E_STORE_DB_OPEN',
      context: { file },
      cause,
    });
  }
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}

/** PRAGMA integrity_check, surfaced as data for the integrity report. */
export function sqliteIntegrityCheck(db: SqliteDatabase): { ok: boolean; findings: string[] } {
  const rows = db.pragma('integrity_check') as { integrity_check: string }[];
  const findings = rows.map((row) => row.integrity_check).filter((finding) => finding !== 'ok');
  return { ok: findings.length === 0, findings };
}
