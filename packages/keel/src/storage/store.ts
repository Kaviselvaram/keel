/**
 * KeelStore — the storage platform's lifecycle owner (Doc 20 §8): opened at
 * a composition root (lock → db → migrate-with-backup → construct), closed
 * on shutdown. Everything above this boundary sees repositories and the
 * object store; SQLite and the directory layout are invisible (C36).
 */

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { EnvironmentError, systemClock, ulid } from '../shared/index.js';
import type { Clock } from '../shared/index.js';
import type { Logger } from '../observability/index.js';
import type { SqliteDatabase } from './database.js';
import { openDatabase } from './database.js';
import { acquireStoreLock } from './lock.js';
import type { StoreLock } from './lock.js';
import { runMigrations } from './migrations.js';
import type { Migration } from './migrations.js';
import { SCHEMA_MIGRATIONS } from './schema.js';
import { ObjectStore } from './object-store.js';
import type { CrashSeams } from './object-store.js';
import { DocumentStore } from './document-store.js';
import { SqliteBaselineRepository } from './repositories/baseline-repository.js';
import { SqliteVerdictRepository } from './repositories/verdict-repository.js';
import { SqliteSuppressionRepository } from './repositories/suppression-repository.js';
import { collectGarbage } from './gc.js';
import type { GcReport } from './gc.js';
import { verifyStoreIntegrity } from './integrity.js';
import type { IntegrityReport } from './integrity.js';

export interface OpenStoreOptions {
  readonly directory: string;
  readonly logger: Logger;
  readonly clock?: Clock;
  readonly lockTimeoutMs?: number;
  readonly maxObjectBytes?: number;
  /** Test seam (crash-injection matrix); never set in production wiring. */
  readonly crashSeams?: CrashSeams;
  /** Test seam: override the migration list. Production uses SCHEMA_MIGRATIONS. */
  readonly migrations?: readonly Migration[];
}

export class KeelStore {
  readonly directory: string;
  readonly objects: ObjectStore;
  readonly documents: DocumentStore;
  readonly baselines: SqliteBaselineRepository;
  readonly verdicts: SqliteVerdictRepository;
  readonly suppressions: SqliteSuppressionRepository;

  private readonly db: SqliteDatabase;
  private readonly lock: StoreLock;
  private readonly logger: Logger;
  private readonly clock: Clock;
  private closed = false;

  private constructor(fields: {
    directory: string;
    db: SqliteDatabase;
    lock: StoreLock;
    logger: Logger;
    clock: Clock;
    objects: ObjectStore;
  }) {
    this.directory = fields.directory;
    this.db = fields.db;
    this.lock = fields.lock;
    this.logger = fields.logger;
    this.clock = fields.clock;
    this.objects = fields.objects;
    this.documents = new DocumentStore(fields.db, fields.objects);
    this.baselines = new SqliteBaselineRepository(fields.db, this.documents, fields.clock);
    this.verdicts = new SqliteVerdictRepository(fields.db, this.documents, fields.clock);
    this.suppressions = new SqliteSuppressionRepository(fields.db, this.documents, fields.clock);
  }

  static async open(options: OpenStoreOptions): Promise<KeelStore> {
    const directory = path.resolve(options.directory);
    const clock = options.clock ?? systemClock;
    const logger = options.logger;

    await mkdir(directory, { recursive: true, mode: 0o700 });
    for (const sub of ['objects', 'tmp', 'backups']) {
      await mkdir(path.join(directory, sub), { recursive: true });
    }

    const lock = await acquireStoreLock({
      directory,
      timeoutMs: options.lockTimeoutMs ?? 5_000,
      logger,
      clock,
    });

    let db: SqliteDatabase | undefined;
    try {
      db = openDatabase(path.join(directory, 'keel.db'));
      const migrated = await runMigrations({
        db,
        migrations: options.migrations ?? SCHEMA_MIGRATIONS,
        clock,
        logger,
        backup: async (fromVersion) => {
          if (fromVersion === 0) return; // nothing to protect on first init
          const target = path.join(directory, 'backups', `keel-v${String(fromVersion)}.db`);
          await (db as SqliteDatabase).backup(target);
          logger.info('storage.migration.backup', { target, fromVersion });
        },
      });
      db.prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)').run('store_id', ulid());
      logger.info('storage.open.ok', { directory, schemaFrom: migrated.from, schemaTo: migrated.to });

      const objects = new ObjectStore({
        db,
        directory,
        logger,
        clock,
        ...(options.maxObjectBytes === undefined ? {} : { maxObjectBytes: options.maxObjectBytes }),
        ...(options.crashSeams === undefined ? {} : { crashSeams: options.crashSeams }),
      });
      return new KeelStore({ directory, db, lock, logger, clock, objects });
    } catch (error) {
      db?.close();
      await lock.release();
      throw error;
    }
  }

  storeId(): string {
    this.assertOpen();
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get('store_id') as
      | { value: string }
      | undefined;
    return row?.value ?? 'unknown';
  }

  async integrity(): Promise<IntegrityReport> {
    this.assertOpen();
    return verifyStoreIntegrity(this.db, this.objects);
  }

  /** Explicit, dry-run-by-default garbage collection (C39). */
  async gc(options: { apply?: boolean; tempGraceMs?: number } = {}): Promise<GcReport> {
    this.assertOpen();
    return collectGarbage({
      db: this.db,
      directory: this.directory,
      logger: this.logger,
      nowEpochMs: this.clock.epochMillis(),
      ...(options.apply === undefined ? {} : { apply: options.apply }),
      ...(options.tempGraceMs === undefined ? {} : { tempGraceMs: options.tempGraceMs }),
    });
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new EnvironmentError('store is closed', { code: 'KEEL_E_STORE_CLOSED', context: {} });
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
    await this.lock.release();
    this.logger.info('storage.close.ok', { directory: this.directory });
  }
}
