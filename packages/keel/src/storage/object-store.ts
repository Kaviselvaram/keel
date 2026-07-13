/**
 * Content-addressed object store (Doc 08, ADR-003, ADR-018).
 *
 * Layout: objects/<hh>/<rest-of-hash>, gzip-encoded (ADR-018: zstd needs
 * Node ≥23.8 or a native dep; encoding is recorded per object so a future
 * zstd is additive). Hashes are always of UNCOMPRESSED content — compression
 * is transport, never identity.
 *
 * Write protocol (crash safety): random-named temp file in tmp/ → fsync →
 * atomic rename into place → row insert. A crash at any point leaves either
 * nothing or an invisible file (garbage, GC-collectable) — never a visible
 * partial object. Rows are the source of reachability (Doc 02 §8).
 *
 * Corruption: verified on every read; a mismatching object is moved to
 * quarantine/ and reported via IntegrityError — never auto-healed (C33,
 * Doc 10 C1).
 */

import { randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { chmod, mkdir, open, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createGzip, createGunzip, gunzipSync, gzipSync } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { EnvironmentError, IntegrityError } from '../shared/index.js';
import type { Clock } from '../shared/index.js';
import type { Logger } from '../observability/index.js';
import { hashBytes, isContentHash } from '../model/index.js';
import type { ContentHash } from '../model/index.js';
import { createHash } from 'node:crypto';
import type { SqliteDatabase } from './database.js';

export interface ObjectStat {
  readonly hash: ContentHash;
  readonly size: number;
  readonly storedSize: number;
  readonly encoding: 'gzip' | 'raw';
  readonly pinned: boolean;
}

export interface PutResult {
  readonly hash: ContentHash;
  readonly size: number;
  readonly deduplicated: boolean;
}

/**
 * Crash-injection seams for the kill-matrix tests (Doc 24 P3 acceptance).
 * Unset in production; when set, they throw at the named pipeline stage.
 */
export interface CrashSeams {
  readonly afterTempWrite?: () => void;
  readonly afterRename?: () => void;
}

export interface ObjectStoreOptions {
  readonly db: SqliteDatabase;
  readonly directory: string;
  readonly logger: Logger;
  readonly clock: Clock;
  /** In-memory API ceiling; larger objects must use the streaming API. Default 64 MiB. */
  readonly maxObjectBytes?: number;
  readonly crashSeams?: CrashSeams;
}

const DEFAULT_MAX_OBJECT_BYTES = 64 * 1024 * 1024;

/** Zero-copy view that is exactly Uint8Array, never a Buffer subclass. */
function asPlainBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export class ObjectStore {
  private readonly db: SqliteDatabase;
  private readonly objectsDir: string;
  private readonly tmpDir: string;
  private readonly quarantineDir: string;
  private readonly logger: Logger;
  private readonly clock: Clock;
  private readonly maxObjectBytes: number;
  private readonly seams: CrashSeams;

  constructor(options: ObjectStoreOptions) {
    this.db = options.db;
    this.objectsDir = path.join(options.directory, 'objects');
    this.tmpDir = path.join(options.directory, 'tmp');
    this.quarantineDir = path.join(options.directory, 'quarantine');
    this.logger = options.logger;
    this.clock = options.clock;
    this.maxObjectBytes = options.maxObjectBytes ?? DEFAULT_MAX_OBJECT_BYTES;
    this.seams = options.crashSeams ?? {};
  }

  private objectPath(hash: ContentHash): string {
    return path.join(this.objectsDir, hash.slice(0, 2), hash.slice(2));
  }

  private assertHashFormat(hash: string): void {
    if (!isContentHash(hash)) {
      throw new IntegrityError('malformed object hash', {
        code: 'KEEL_E_STORE_BAD_HASH',
        context: { hash },
      });
    }
  }

  private tempPath(): string {
    return path.join(this.tmpDir, `put-${randomBytes(12).toString('hex')}`);
  }

  /** Atomic move into place; Windows rename-over-existing races resolve as dedup. */
  private async commitTempFile(temp: string, final: string): Promise<void> {
    await mkdir(path.dirname(final), { recursive: true });
    try {
      await rename(temp, final);
    } catch (error) {
      if (existsSync(final)) {
        await unlink(temp).catch(() => undefined);
      } else {
        throw new EnvironmentError('object commit rename failed', {
          code: 'KEEL_E_STORE_RENAME',
          context: { final },
          cause: error,
        });
      }
    }
    // Unexpected-mutation defense; best-effort on Windows.
    await chmod(final, 0o444).catch(() => undefined);
  }

  private insertRow(hash: ContentHash, size: number, storedSize: number): boolean {
    const result = this.db
      .prepare(
        'INSERT OR IGNORE INTO objects (hash, size, stored_size, encoding, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(hash, size, storedSize, 'gzip', this.clock.epochMillis());
    return result.changes > 0;
  }

  async put(bytes: Uint8Array): Promise<PutResult> {
    if (bytes.byteLength > this.maxObjectBytes) {
      throw new EnvironmentError('object exceeds the in-memory API ceiling', {
        code: 'KEEL_E_STORE_OBJECT_TOO_LARGE',
        context: { size: bytes.byteLength, limit: this.maxObjectBytes, hint: 'use putStream' },
      });
    }
    const hash = hashBytes(bytes);
    const final = this.objectPath(hash);
    if (this.has(hash) && existsSync(final)) {
      return { hash, size: bytes.byteLength, deduplicated: true };
    }
    const compressed = gzipSync(bytes);
    const temp = this.tempPath();
    const handle = await open(temp, 'wx', 0o600);
    try {
      await handle.writeFile(compressed);
      await handle.sync();
    } finally {
      await handle.close();
    }
    this.seams.afterTempWrite?.();
    await this.commitTempFile(temp, final);
    this.seams.afterRename?.();
    const inserted = this.insertRow(hash, bytes.byteLength, compressed.byteLength);
    return { hash, size: bytes.byteLength, deduplicated: !inserted };
  }

  /** Streaming write: hash and size computed en route; same commit protocol. */
  async putStream(source: AsyncIterable<Uint8Array>): Promise<PutResult> {
    const temp = this.tempPath();
    const hasher = createHash('sha256');
    let size = 0;
    const maxObjectStreamBytes = this.maxObjectBytes * 16;
    const counted = async function* (limit: number): AsyncIterable<Uint8Array> {
      for await (const chunk of source) {
        size += chunk.byteLength;
        if (size > limit) {
          throw new EnvironmentError('streamed object exceeds the streaming ceiling', {
            code: 'KEEL_E_STORE_OBJECT_TOO_LARGE',
            context: { limit },
          });
        }
        hasher.update(chunk);
        yield chunk;
      }
    };
    const gzip = createGzip();
    const sink = createWriteStream(temp, { flags: 'wx', mode: 0o600 });
    try {
      await pipeline(counted(maxObjectStreamBytes), gzip, sink);
      const handle = await open(temp, 'r+');
      await handle.sync();
      await handle.close();
    } catch (error) {
      await unlink(temp).catch(() => undefined);
      throw error;
    }
    const hash = hasher.digest('hex') as ContentHash;
    const storedSize = (await stat(temp)).size;
    this.seams.afterTempWrite?.();
    const final = this.objectPath(hash);
    if (this.has(hash) && existsSync(final)) {
      await unlink(temp).catch(() => undefined);
      return { hash, size, deduplicated: true };
    }
    await this.commitTempFile(temp, final);
    this.seams.afterRename?.();
    const inserted = this.insertRow(hash, size, storedSize);
    return { hash, size, deduplicated: !inserted };
  }

  has(hash: ContentHash): boolean {
    this.assertHashFormat(hash);
    return (
      this.db.prepare('SELECT 1 FROM objects WHERE hash = ?').get(hash) !== undefined
    );
  }

  statObject(hash: ContentHash): ObjectStat | undefined {
    this.assertHashFormat(hash);
    const row = this.db
      .prepare('SELECT hash, size, stored_size, encoding, pinned FROM objects WHERE hash = ?')
      .get(hash) as
      | { hash: string; size: number; stored_size: number; encoding: 'gzip' | 'raw'; pinned: number }
      | undefined;
    if (row === undefined) return undefined;
    return {
      hash: row.hash,
      size: row.size,
      storedSize: row.stored_size,
      encoding: row.encoding,
      pinned: row.pinned === 1,
    };
  }

  private async quarantine(hash: ContentHash, reason: string): Promise<void> {
    const source = this.objectPath(hash);
    const target = path.join(this.quarantineDir, hash);
    await mkdir(this.quarantineDir, { recursive: true });
    await chmod(source, 0o600).catch(() => undefined);
    await rename(source, target).catch(() => undefined);
    this.logger.error('storage.object.quarantined', { hash, reason });
  }

  /** Verified read: content is re-hashed before return (C33). */
  async get(hash: ContentHash): Promise<Uint8Array> {
    const info = this.statObject(hash);
    if (info === undefined) {
      throw new EnvironmentError('object not found', {
        code: 'KEEL_E_STORE_OBJECT_MISSING',
        context: { hash },
      });
    }
    if (info.size > this.maxObjectBytes) {
      throw new EnvironmentError('object exceeds the in-memory API ceiling', {
        code: 'KEEL_E_STORE_OBJECT_TOO_LARGE',
        context: { size: info.size, limit: this.maxObjectBytes, hint: 'use getStream' },
      });
    }
    const file = this.objectPath(hash);
    let compressed: Uint8Array;
    try {
      const handle = await open(file, 'r');
      try {
        compressed = await handle.readFile();
      } finally {
        await handle.close();
      }
    } catch (cause) {
      throw new IntegrityError('object file missing for indexed hash', {
        code: 'KEEL_E_STORE_OBJECT_FILE_MISSING',
        context: { hash },
        cause,
      });
    }
    let bytes: Uint8Array;
    try {
      bytes = gunzipSync(compressed);
    } catch (cause) {
      await this.quarantine(hash, 'undecodable');
      throw new IntegrityError('object is undecodable — quarantined', {
        code: 'KEEL_E_STORE_OBJECT_CORRUPT',
        context: { hash },
        cause,
      });
    }
    if (hashBytes(bytes) !== hash) {
      await this.quarantine(hash, 'hash-mismatch');
      throw new IntegrityError('object content does not match its hash — quarantined', {
        code: 'KEEL_E_STORE_OBJECT_CORRUPT',
        context: { hash },
      });
    }
    // Plain Uint8Array at the API boundary — Buffer leaks change consumer
    // behavior (JSON serialization, equality semantics).
    return asPlainBytes(bytes);
  }

  /**
   * Streaming read. Verification completes only at end-of-stream: a consumer
   * may observe bytes of a corrupt object before the final IntegrityError —
   * documented trade; use get() when that is unacceptable.
   */
  async *getStream(hash: ContentHash): AsyncGenerator<Uint8Array> {
    const info = this.statObject(hash);
    if (info === undefined) {
      throw new EnvironmentError('object not found', {
        code: 'KEEL_E_STORE_OBJECT_MISSING',
        context: { hash },
      });
    }
    const hasher = createHash('sha256');
    const gunzip = createGunzip();
    const source = createReadStream(this.objectPath(hash));
    // Forward source failures into the iterator — .pipe() does not propagate
    // errors, and an unforwarded ENOENT would hang the for-await.
    source.on('error', (error) => gunzip.destroy(error));
    source.pipe(gunzip);
    try {
      for await (const chunk of gunzip) {
        const bytes = asPlainBytes(chunk as Uint8Array);
        hasher.update(bytes);
        yield bytes;
      }
    } catch (cause) {
      source.destroy();
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new IntegrityError('object file missing for indexed hash', {
          code: 'KEEL_E_STORE_OBJECT_FILE_MISSING',
          context: { hash },
          cause,
        });
      }
      await this.quarantine(hash, 'undecodable');
      throw new IntegrityError('object is undecodable — quarantined', {
        code: 'KEEL_E_STORE_OBJECT_CORRUPT',
        context: { hash },
        cause,
      });
    }
    if (hasher.digest('hex') !== hash) {
      await this.quarantine(hash, 'hash-mismatch');
      throw new IntegrityError('object content does not match its hash — quarantined', {
        code: 'KEEL_E_STORE_OBJECT_CORRUPT',
        context: { hash },
      });
    }
  }

  /** Retention marker for GC (declared status transition, C32). */
  setPinned(hash: ContentHash, pinned: boolean): void {
    this.assertHashFormat(hash);
    const result = this.db
      .prepare('UPDATE objects SET pinned = ? WHERE hash = ?')
      .run(pinned ? 1 : 0, hash);
    if (result.changes === 0) {
      throw new EnvironmentError('object not found', {
        code: 'KEEL_E_STORE_OBJECT_MISSING',
        context: { hash },
      });
    }
  }

  listHashes(): readonly ContentHash[] {
    return (this.db.prepare('SELECT hash FROM objects ORDER BY hash').all() as { hash: string }[]).map(
      (row) => row.hash,
    );
  }
}
