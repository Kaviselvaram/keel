/**
 * Filesystem manifest: raw fs-effect collection for the workspace
 * (Doc 24 P2). Scans before/after execution; the diff is the raw material
 * capture later normalizes into fs-effect Observations. Paths are always
 * workspace-relative POSIX, so manifests are platform-comparable.
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { ContentHash } from '../model/index.js';

export interface ManifestEntry {
  readonly size: number;
  readonly hash: ContentHash;
}

export type Manifest = ReadonlyMap<string, ManifestEntry>;

export interface RawFsEvent {
  readonly path: string;
  readonly change: 'created' | 'modified' | 'deleted';
  /** Hash of the file's content after the change (absent for deletions). */
  readonly hash?: ContentHash;
  readonly size?: number;
}

async function hashFile(absolute: string): Promise<ContentHash> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    createReadStream(absolute)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', resolve)
      .on('error', reject);
  });
  return hash.digest('hex');
}

/**
 * Scans a directory tree into a manifest. `maxTotalBytes` bounds hashing work
 * (limits.maxFsEffectBytes); exceeding it throws so the engine can surface an
 * output-limit-class exit rather than hashing unbounded data.
 */
export async function scanManifest(root: string, maxTotalBytes: number): Promise<Manifest> {
  const entries = new Map<string, ManifestEntry>();
  let budget = maxTotalBytes;

  async function walk(dir: string, prefix: string): Promise<void> {
    const names = (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
      a.name < b.name ? -1 : 1,
    );
    for (const entry of names) {
      const absolute = path.join(dir, entry.name);
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(absolute, relative);
      } else if (entry.isFile()) {
        const info = await stat(absolute);
        budget -= info.size;
        if (budget < 0) {
          throw new FsBudgetExceeded(relative);
        }
        entries.set(relative, { size: info.size, hash: await hashFile(absolute) });
      }
      // Symlinks and specials are ignored by design: the workspace is
      // engine-created, and following links would escape the boundary.
    }
  }

  await walk(root, '');
  return entries;
}

/** Internal control-flow signal for budget exhaustion (translated by the engine). */
export class FsBudgetExceeded extends Error {
  readonly atPath: string;
  constructor(atPath: string) {
    super(`fs-effect budget exceeded at ${atPath}`);
    this.name = 'FsBudgetExceeded';
    this.atPath = atPath;
  }
}

/** Deterministic manifest diff, sorted by path. */
export function diffManifests(before: Manifest, after: Manifest): readonly RawFsEvent[] {
  const events: RawFsEvent[] = [];
  for (const [relative, entry] of after) {
    const previous = before.get(relative);
    if (previous === undefined) {
      events.push({ path: relative, change: 'created', hash: entry.hash, size: entry.size });
    } else if (previous.hash !== entry.hash) {
      events.push({ path: relative, change: 'modified', hash: entry.hash, size: entry.size });
    }
  }
  for (const relative of before.keys()) {
    if (!after.has(relative)) {
      events.push({ path: relative, change: 'deleted' });
    }
  }
  return events.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
