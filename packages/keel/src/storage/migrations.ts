/**
 * Migration runner (Doc 08, Doc 24 P3): backup-before-migrate, each
 * migration in its own transaction, audit rows in `migrations`. Migration
 * content never alters CAS objects (C33) — schema evolves, hashed content
 * does not.
 */

import { EnvironmentError, invariant } from '../shared/index.js';
import type { Clock } from '../shared/index.js';
import type { Logger } from '../observability/index.js';
import type { SqliteDatabase } from './database.js';

export interface Migration {
  readonly version: number;
  readonly name: string;
  up(db: SqliteDatabase): void;
}

export interface MigrationOptions {
  readonly db: SqliteDatabase;
  readonly migrations: readonly Migration[];
  /** Called once before any pending migration runs; receives the current version. */
  readonly backup: (fromVersion: number) => Promise<void>;
  readonly logger: Logger;
  readonly clock: Clock;
}

function currentVersion(db: SqliteDatabase): number {
  db.exec(`CREATE TABLE IF NOT EXISTS migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  )`);
  const row = db.prepare('SELECT MAX(version) AS v FROM migrations').get() as { v: number | null };
  return row.v ?? 0;
}

export async function runMigrations(options: MigrationOptions): Promise<{ from: number; to: number }> {
  const ordered = [...options.migrations].sort((a, b) => a.version - b.version);
  ordered.forEach((migration, index) => {
    invariant(
      migration.version === index + 1,
      'migrations must be contiguous starting at 1',
      { at: migration.version },
    );
  });

  const from = currentVersion(options.db);
  const pending = ordered.filter((migration) => migration.version > from);
  const known = ordered.length;
  if (from > known) {
    // Forward compatibility (C34): a newer KEEL wrote this store — refuse.
    throw new EnvironmentError('store schema is newer than this build understands', {
      code: 'KEEL_E_STORE_SCHEMA_TOO_NEW',
      context: { storeVersion: from, supported: known },
    });
  }
  if (pending.length === 0) return { from, to: from };

  await options.backup(from);

  const record = options.db.prepare('INSERT INTO migrations (version, name, applied_at) VALUES (?, ?, ?)');
  for (const migration of pending) {
    const apply = options.db.transaction(() => {
      migration.up(options.db);
      record.run(migration.version, migration.name, options.clock.epochMillis());
    });
    try {
      apply();
    } catch (cause) {
      throw new EnvironmentError(`migration ${String(migration.version)} (${migration.name}) failed`, {
        code: 'KEEL_E_STORE_MIGRATION_FAILED',
        context: { version: migration.version, restoredFromBackup: false },
        cause,
      });
    }
    options.logger.info('storage.migration.applied', {
      version: migration.version,
      name: migration.name,
    });
  }
  return { from, to: pending[pending.length - 1]?.version ?? from };
}
