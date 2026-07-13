import { mkdtemp, mkdir, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import fc from 'fast-check';
import { afterAll, describe, expect, it } from 'vitest';
import { diffManifests, FsBudgetExceeded, scanManifest } from '../manifest.js';
import type { Manifest, ManifestEntry } from '../manifest.js';

const roots: string[] = [];
async function tempTree(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'keel-manifest-'));
  roots.push(root);
  return root;
}
afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

const fakeHash = (seed: string): string => seed.repeat(64).slice(0, 64);

const manifestArb: fc.Arbitrary<Manifest> = fc
  .dictionary(fc.constantFrom('a', 'b', 'c/d', 'c/e', 'f'), fc.constantFrom('1', '2', '3'), { maxKeys: 5 })
  .map(
    (record) =>
      new Map(
        Object.entries(record).map(([file, version]): [string, ManifestEntry] => [
          file,
          { size: Number(version), hash: fakeHash(version) },
        ]),
      ),
  );

describe('manifest scan + diff on a real tree', () => {
  it('detects created, modified, and deleted files against a prior scan', async () => {
    const root = await tempTree();
    await writeFile(path.join(root, 'keep.txt'), 'same');
    await writeFile(path.join(root, 'change.txt'), 'v1');
    await writeFile(path.join(root, 'remove.txt'), 'bye');
    const before = await scanManifest(root, Number.MAX_SAFE_INTEGER);

    await writeFile(path.join(root, 'change.txt'), 'v2');
    await unlink(path.join(root, 'remove.txt'));
    await mkdir(path.join(root, 'sub'));
    await writeFile(path.join(root, 'sub', 'new.txt'), 'hello');
    const after = await scanManifest(root, Number.MAX_SAFE_INTEGER);

    expect(diffManifests(before, after)).toEqual([
      { path: 'change.txt', change: 'modified', hash: expect.any(String), size: 2 },
      { path: 'remove.txt', change: 'deleted' },
      { path: 'sub/new.txt', change: 'created', hash: expect.any(String), size: 5 },
    ]);
  });

  it('enforces the byte budget', async () => {
    const root = await tempTree();
    await writeFile(path.join(root, 'big.bin'), 'x'.repeat(1000));
    await expect(scanManifest(root, 100)).rejects.toBeInstanceOf(FsBudgetExceeded);
  });
});

describe('manifest diff properties', () => {
  it('diff(x, x) is empty', () => {
    fc.assert(
      fc.property(manifestArb, (manifest) => {
        expect(diffManifests(manifest, manifest)).toEqual([]);
      }),
    );
  });

  it('every after-path appears as created|modified, every removed path as deleted, sorted', () => {
    fc.assert(
      fc.property(manifestArb, manifestArb, (before, after) => {
        const events = diffManifests(before, after);
        const paths = events.map((event) => event.path);
        expect([...paths].sort()).toEqual(paths);
        for (const event of events) {
          if (event.change === 'deleted') {
            expect(before.has(event.path)).toBe(true);
            expect(after.has(event.path)).toBe(false);
          } else {
            expect(after.has(event.path)).toBe(true);
            expect(event.hash).toBe(after.get(event.path)?.hash);
          }
        }
        // Unchanged entries never emit events.
        for (const [file, entry] of after) {
          if (before.get(file)?.hash === entry.hash) {
            expect(paths).not.toContain(file);
          }
        }
      }),
    );
  });

  it('diff is deterministic', () => {
    fc.assert(
      fc.property(manifestArb, manifestArb, (before, after) => {
        expect(diffManifests(before, after)).toEqual(diffManifests(before, after));
      }),
    );
  });
});
