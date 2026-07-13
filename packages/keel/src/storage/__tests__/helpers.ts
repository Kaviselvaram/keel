/** Test-only store factory with tracked cleanup (close db before rm — Windows). */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { noopLogger } from '../../observability/index.js';
import { KeelStore } from '../store.js';
import type { OpenStoreOptions } from '../store.js';

const opened: KeelStore[] = [];
const dirs: string[] = [];

export async function tempStoreDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'keel-store-'));
  dirs.push(dir);
  return dir;
}

export async function openTestStore(
  overrides: Partial<OpenStoreOptions> = {},
): Promise<KeelStore> {
  const directory = overrides.directory ?? (await tempStoreDir());
  const store = await KeelStore.open({ directory, logger: noopLogger, ...overrides });
  opened.push(store);
  return store;
}

export async function cleanupStores(): Promise<void> {
  for (const store of opened.splice(0)) {
    await store.close().catch(() => undefined);
  }
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true, maxRetries: 5 }).catch(() => undefined);
  }
}
