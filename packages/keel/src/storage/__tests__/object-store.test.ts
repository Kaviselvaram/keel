import { readFile, writeFile, chmod } from 'node:fs/promises';
import path from 'node:path';
import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import { gzipSync } from 'node:zlib';
import { EnvironmentError, IntegrityError } from '../../shared/index.js';
import { hashBytes } from '../../model/index.js';
import { cleanupStores, openTestStore } from './helpers.js';

afterEach(cleanupStores);

const bytesOf = (text: string) => new TextEncoder().encode(text);

async function collect(stream: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of stream) {
    chunks.push(chunk);
    length += chunk.byteLength;
  }
  const merged = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

describe('object store', () => {
  it('round-trips bytes with verified reads and correct stat metadata', async () => {
    const store = await openTestStore();
    const bytes = bytesOf('hello content addressing');
    const { hash, deduplicated } = await store.objects.put(bytes);
    expect(deduplicated).toBe(false);
    expect(hash).toBe(hashBytes(bytes));
    expect(await store.objects.get(hash)).toEqual(bytes);
    const stat = store.objects.statObject(hash);
    expect(stat?.size).toBe(bytes.byteLength);
    expect(stat?.encoding).toBe('gzip');
  });

  it('deduplicates identical content (one row, one file)', async () => {
    const store = await openTestStore();
    const bytes = bytesOf('same twice');
    const first = await store.objects.put(bytes);
    const second = await store.objects.put(bytes);
    expect(second.deduplicated).toBe(true);
    expect(second.hash).toBe(first.hash);
    expect(store.objects.listHashes()).toHaveLength(1);
  });

  it('streaming write equals buffered write; streaming read round-trips large objects', async () => {
    const store = await openTestStore();
    const big = new Uint8Array(5 * 1024 * 1024).map((_, index) => index % 251);
    async function* chunks(): AsyncIterable<Uint8Array> {
      for (let offset = 0; offset < big.byteLength; offset += 65536) {
        yield big.subarray(offset, Math.min(offset + 65536, big.byteLength));
      }
    }
    const streamed = await store.objects.putStream(chunks());
    expect(streamed.hash).toBe(hashBytes(big));
    expect(streamed.size).toBe(big.byteLength);
    const readBack = await collect(store.objects.getStream(streamed.hash));
    expect(hashBytes(readBack)).toBe(streamed.hash);
  });

  it('enforces the in-memory ceiling with a streaming hint', async () => {
    const store = await openTestStore({ maxObjectBytes: 1024 });
    await expect(store.objects.put(new Uint8Array(2048))).rejects.toMatchObject({
      code: 'KEEL_E_STORE_OBJECT_TOO_LARGE',
    });
    const small = await store.objects.put(new Uint8Array(10));
    expect(store.objects.has(small.hash)).toBe(true);
  });

  it('detects corruption on read, quarantines, and never auto-heals (C33)', async () => {
    const store = await openTestStore();
    const { hash } = await store.objects.put(bytesOf('to be corrupted'));
    const file = path.join(store.directory, 'objects', hash.slice(0, 2), hash.slice(2));
    await chmod(file, 0o600);
    await writeFile(file, gzipSync(bytesOf('EVIL REPLACEMENT')));
    await expect(store.objects.get(hash)).rejects.toBeInstanceOf(IntegrityError);
    // Quarantined: original path gone, quarantine copy present.
    await expect(readFile(file)).rejects.toThrow();
    await expect(readFile(path.join(store.directory, 'quarantine', hash))).resolves.toBeDefined();
    // Missing after quarantine surfaces as file-missing integrity failure, not silence.
    await expect(store.objects.get(hash)).rejects.toMatchObject({
      code: 'KEEL_E_STORE_OBJECT_FILE_MISSING',
    });
  });

  it('missing object is an EnvironmentError; malformed hash is an IntegrityError', async () => {
    const store = await openTestStore();
    await expect(store.objects.get('f'.repeat(64))).rejects.toBeInstanceOf(EnvironmentError);
    await expect(store.objects.get('nonsense')).rejects.toBeInstanceOf(IntegrityError);
  });

  it('pinning is a declared transition and requires existence', async () => {
    const store = await openTestStore();
    const { hash } = await store.objects.put(bytesOf('pin me'));
    store.objects.setPinned(hash, true);
    expect(store.objects.statObject(hash)?.pinned).toBe(true);
    expect(() => store.objects.setPinned('e'.repeat(64), true)).toThrowError(EnvironmentError);
  });
});

describe('object store properties', () => {
  it('put/get round-trips arbitrary bytes; hash is stable and content-equal inputs dedup', async () => {
    const store = await openTestStore();
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ maxLength: 4096 }), async (bytes) => {
        const first = await store.objects.put(bytes);
        const second = await store.objects.put(new Uint8Array(bytes));
        expect(second.hash).toBe(first.hash);
        expect(second.deduplicated).toBe(true);
        expect(await store.objects.get(first.hash)).toEqual(bytes);
      }),
      { numRuns: 30 },
    );
  });

  it('distinct content yields distinct hashes (no accidental collisions in practice)', async () => {
    const store = await openTestStore();
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ maxLength: 512 }),
        fc.uint8Array({ maxLength: 512 }),
        async (a, b) => {
          const [pa, pb] = [await store.objects.put(a), await store.objects.put(b)];
          expect(pa.hash === pb.hash).toBe(Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0);
        },
      ),
      { numRuns: 30 },
    );
  });
});
