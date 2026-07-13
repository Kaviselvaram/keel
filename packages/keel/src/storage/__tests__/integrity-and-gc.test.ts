import { writeFile, chmod, access } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalBytes } from '../../model/index.js';
import { cleanupStores, openTestStore } from './helpers.js';

afterEach(cleanupStores);

const bytesOf = (text: string) => new TextEncoder().encode(text);

describe('integrity report', () => {
  it('a healthy store reports ok with every object verified', async () => {
    const store = await openTestStore();
    await store.objects.put(bytesOf('one'));
    await store.objects.put(bytesOf('two'));
    const report = await store.integrity();
    expect(report.ok).toBe(true);
    expect(report.sqlite.ok).toBe(true);
    expect(report.objects.verified).toBe(2);
    expect(report.objects.corrupt).toEqual([]);
  });

  it('detects corrupt and missing objects without repairing them', async () => {
    const store = await openTestStore();
    const good = await store.objects.put(bytesOf('good'));
    const bad = await store.objects.put(bytesOf('will corrupt'));
    const file = path.join(store.directory, 'objects', bad.hash.slice(0, 2), bad.hash.slice(2));
    await chmod(file, 0o600);
    await writeFile(file, gzipSync(bytesOf('tampered')));
    const report = await store.integrity();
    expect(report.ok).toBe(false);
    expect(report.objects.corrupt).toEqual([bad.hash]);
    expect(report.objects.verified).toBe(1);
    // The good object is untouched; the corrupt one is quarantined, not healed.
    expect(await store.objects.get(good.hash)).toEqual(bytesOf('good'));
  });
});

describe('gc foundation (dry-run by default, C39)', () => {
  it('reachability follows document refs; pins protect; apply removes only dangling', async () => {
    const store = await openTestStore();
    // leaf ← document(refs leaf): both reachable only if a root points at the doc.
    const leaf = await store.objects.put(bytesOf('leaf payload'));
    const docHash = await store.documents.putDocument({ payload: leaf.hash }, [leaf.hash]);
    const orphan = await store.objects.put(bytesOf('orphan'));
    const pinned = await store.objects.put(bytesOf('pinned survivor'));
    store.objects.setPinned(pinned.hash, true);

    const dry = await store.gc();
    expect(dry.applied).toBe(false);
    // No index root references docHash → the doc chain is dangling too.
    expect(new Set(dry.dangling)).toEqual(new Set([leaf.hash, docHash, orphan.hash]));
    // Dry run deleted nothing.
    expect(store.objects.has(orphan.hash)).toBe(true);

    // Pin the document: its ref chain becomes reachable.
    store.objects.setPinned(docHash, true);
    const afterPin = await store.gc();
    expect(new Set(afterPin.dangling)).toEqual(new Set([orphan.hash]));

    const applied = await store.gc({ apply: true });
    expect(applied.applied).toBe(true);
    expect(store.objects.has(orphan.hash)).toBe(false);
    expect(store.objects.has(pinned.hash)).toBe(true);
    expect(store.objects.has(leaf.hash)).toBe(true);
    const file = path.join(store.directory, 'objects', orphan.hash.slice(0, 2), orphan.hash.slice(2));
    await expect(access(file)).rejects.toThrow();
  });

  it('document refs to missing objects are refused at write time', async () => {
    const store = await openTestStore();
    await expect(
      store.documents.putDocument({ x: 1 }, ['9'.repeat(64)]),
    ).rejects.toMatchObject({ code: 'KEEL_E_STORE_MISSING_REFERENT' });
  });

  it('documents round-trip through the CAS', async () => {
    const store = await openTestStore();
    const value = { nested: { deterministic: true }, list: [1, 2, 3] };
    const hash = await store.documents.putDocument(value);
    expect(await store.documents.getDocument(hash)).toEqual(value);
    // Same content, same address (dedup at document level for free).
    expect(await store.documents.putDocument({ list: [1, 2, 3], nested: { deterministic: true } })).toBe(hash);
    expect(canonicalBytes(value).byteLength).toBeGreaterThan(0);
  });
});
