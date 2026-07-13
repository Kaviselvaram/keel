import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SCHEMA_MIGRATIONS } from '../schema.js';
import type { Migration } from '../migrations.js';
import { KeelStore } from '../store.js';
import { noopLogger } from '../../observability/index.js';
import { cleanupStores, openTestStore, tempStoreDir } from './helpers.js';

afterEach(cleanupStores);

const fakeV2: Migration = {
  version: 2,
  name: 'test-add-table',
  up(db) {
    db.exec('CREATE TABLE test_extra (id TEXT PRIMARY KEY)');
  },
};

const failingV2: Migration = {
  version: 2,
  name: 'test-broken',
  up(db) {
    db.exec('CREATE TABLE half_done (id TEXT)');
    throw new Error('boom mid-migration');
  },
};

describe('migration runner', () => {
  it('initializes schema v1 with no backup on first init', async () => {
    const dir = await tempStoreDir();
    const store = await openTestStore({ directory: dir });
    expect(store.storeId()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(await readdir(path.join(dir, 'backups'))).toEqual([]);
  });

  it('applies pending migrations with a backup of the prior version', async () => {
    const dir = await tempStoreDir();
    const first = await openTestStore({ directory: dir });
    await first.close();
    const upgraded = await openTestStore({
      directory: dir,
      migrations: [...SCHEMA_MIGRATIONS, fakeV2],
    });
    expect(await readdir(path.join(dir, 'backups'))).toEqual(['keel-v1.db']);
    await upgraded.close();
  });

  it('a failing migration rolls back atomically and reports the failure', async () => {
    const dir = await tempStoreDir();
    const first = await openTestStore({ directory: dir });
    await first.close();
    await expect(
      KeelStore.open({
        directory: dir,
        logger: noopLogger,
        migrations: [...SCHEMA_MIGRATIONS, failingV2],
      }),
    ).rejects.toMatchObject({ code: 'KEEL_E_STORE_MIGRATION_FAILED' });
    // Store still opens at v1 — the failed migration left nothing behind.
    const reopened = await openTestStore({ directory: dir });
    expect(reopened.baselines.list()).toEqual([]);
  });

  it('refuses a store written by a newer schema (forward compatibility, C34)', async () => {
    const dir = await tempStoreDir();
    const newer = await openTestStore({
      directory: dir,
      migrations: [...SCHEMA_MIGRATIONS, fakeV2],
    });
    await newer.close();
    await expect(
      KeelStore.open({ directory: dir, logger: noopLogger }),
    ).rejects.toMatchObject({ code: 'KEEL_E_STORE_SCHEMA_TOO_NEW' });
  });
});

describe('advisory lock (one writer per store)', () => {
  it('excludes a second opener until the first closes', async () => {
    const dir = await tempStoreDir();
    const first = await openTestStore({ directory: dir });
    await expect(
      KeelStore.open({ directory: dir, logger: noopLogger, lockTimeoutMs: 300 }),
    ).rejects.toMatchObject({ code: 'KEEL_E_STORE_LOCKED' });
    await first.close();
    const second = await openTestStore({ directory: dir });
    expect(second.storeId()).toBeDefined();
  });

  it('reclaims a stale lock from a dead process', async () => {
    const dir = await tempStoreDir();
    const { writeFile } = await import('node:fs/promises');
    // A pid that cannot be alive: max pid space on Linux is < 2^22.
    await writeFile(
      path.join(dir, 'lock'),
      JSON.stringify({ pid: 2 ** 30, acquiredAtEpochMs: 0 }),
    );
    const store = await openTestStore({ directory: dir, lockTimeoutMs: 2_000 });
    expect(store.storeId()).toBeDefined();
  });

  it('reclaims an unreadable (torn) lock file', async () => {
    const dir = await tempStoreDir();
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path.join(dir, 'lock'), '{"pid": 12'); // torn write
    const store = await openTestStore({ directory: dir, lockTimeoutMs: 2_000 });
    expect(store.storeId()).toBeDefined();
  });
});
