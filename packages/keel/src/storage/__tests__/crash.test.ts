/**
 * Crash-injection matrix (Doc 24 P3 acceptance): a kill at any pipeline
 * stage must never yield visible partial state. Invariant checked after
 * every crash: the store opens (stale lock reclaimed), SQLite passes
 * integrity_check, and every indexed entity is fully readable. Dangling
 * CAS files/objects are permitted garbage — invisible, GC-collectable —
 * never corruption.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalBytes } from '../../model/index.js';
import type { KeelStore } from '../store.js';
import { cleanupStores, openTestStore, tempStoreDir } from './helpers.js';

afterEach(cleanupStores);

const bytesOf = (text: string) => new TextEncoder().encode(text);

/** The post-crash invariant: everything visible is complete and verified. */
async function assertNoVisiblePartialState(store: KeelStore): Promise<void> {
  const report = await store.integrity();
  expect(report.sqlite.ok).toBe(true);
  expect(report.objects.corrupt).toEqual([]);
  expect(report.objects.missingFiles).toEqual([]);
  for (const summary of store.baselines.list()) {
    const baseline = await store.baselines.getById(summary.id);
    expect(baseline).toBeDefined();
    for (const hash of Object.values(store.baselines.snapshotHashes(summary.id))) {
      expect(await store.objects.get(hash)).toBeDefined();
    }
  }
}

describe('failpoint matrix (deterministic stage kills)', () => {
  it('crash after temp write: object invisible, store consistent', async () => {
    const dir = await tempStoreDir();
    const seamed = await openTestStore({
      directory: dir,
      crashSeams: { afterTempWrite: () => { throw new Error('simulated crash'); } },
    });
    await expect(seamed.objects.put(bytesOf('never lands'))).rejects.toThrow('simulated crash');
    await seamed.close();

    const reopened = await openTestStore({ directory: dir });
    expect(reopened.objects.listHashes()).toEqual([]);
    await assertNoVisiblePartialState(reopened);
    // The stranded temp file is reported as stale garbage by GC.
    const gc = await reopened.gc({ tempGraceMs: 0 });
    expect(gc.staleTempFiles.length).toBe(1);
  });

  it('crash after rename but before row: file exists, object invisible, still consistent', async () => {
    const dir = await tempStoreDir();
    const seamed = await openTestStore({
      directory: dir,
      crashSeams: { afterRename: () => { throw new Error('simulated crash'); } },
    });
    await expect(seamed.objects.put(bytesOf('renamed then crash'))).rejects.toThrow('simulated crash');
    await seamed.close();

    const reopened = await openTestStore({ directory: dir });
    // No row → not visible, has() false, integrity clean (index is reachability source).
    expect(reopened.objects.listHashes()).toEqual([]);
    await assertNoVisiblePartialState(reopened);
    // Re-putting the same content simply completes the write (idempotent).
    const retried = await reopened.objects.put(bytesOf('renamed then crash'));
    expect(await reopened.objects.get(retried.hash)).toEqual(bytesOf('renamed then crash'));
  });
});

const distEntry = fileURLToPath(new URL('../../../dist/index.js', import.meta.url));
const distReady = existsSync(distEntry);
if (!distReady && process.env['CI'] !== undefined) {
  throw new Error('crash matrix requires the built dist in CI — build must precede test');
}

describe.skipIf(!distReady)('real SIGKILL matrix (child process on the built dist)', () => {
  const fixture = fileURLToPath(new URL('./fixtures/crash-child.mjs', import.meta.url));

  async function crashChildAfter(markers: number): Promise<string> {
    const dir = await tempStoreDir();
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [fixture, dir], { stdio: ['ignore', 'pipe', 'pipe'] });
      let seen = 0;
      let errText = '';
      child.stderr.on('data', (data: Buffer) => { errText += data.toString(); });
      child.stdout.on('data', (data: Buffer) => {
        for (const line of data.toString().split('\n')) {
          if (line === 'READY' || line.startsWith('ITER:')) {
            seen += 1;
            if (seen > markers) {
              child.kill('SIGKILL');
            }
          }
        }
      });
      child.once('exit', (code, signal) => {
        if (signal === 'SIGKILL' || code === null) resolve();
        else reject(new Error(`child exited unexpectedly (${String(code)}): ${errText}`));
      });
      child.once('error', reject);
    });
    return dir;
  }

  // Kill right after open, mid-stream, and deep into the write loop.
  for (const markers of [1, 3, 6]) {
    it(`SIGKILL after ${String(markers)} commit markers leaves no visible partial state`, async () => {
      const dir = await crashChildAfter(markers);
      // Reopen: also exercises stale-lock reclaim (the dead child held the lock).
      const store = await openTestStore({ directory: dir, lockTimeoutMs: 5_000 });
      await assertNoVisiblePartialState(store);
      // The store remains fully writable after recovery.
      const put = await store.objects.put(canonicalBytes({ postCrash: true }));
      expect(store.objects.has(put.hash)).toBe(true);
    }, 30_000);
  }
});
