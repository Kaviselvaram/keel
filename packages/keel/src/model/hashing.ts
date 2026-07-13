/**
 * Content addressing — Doc 04, ADR-003 (CAS object ids), C33.
 *
 * The single platform-stdlib import in model/ is `node:crypto` for
 * synchronous SHA-256. Permitted by the frozen dependency budget
 * ("stdlib only" — Doc 01 §2.1, Doc 20 §1); npm imports remain banned by
 * dependency-cruiser. WebCrypto was rejected because digest() is
 * async-only, which would poison every pure construction path.
 */

import { createHash } from 'node:crypto';
import { canonicalBytes } from './canonical.js';
import { HashMismatchError } from './errors.js';
import type { ContentHash } from './identity.js';

/** SHA-256 of raw bytes, lowercase hex. */
export function hashBytes(bytes: Uint8Array): ContentHash {
  return createHash('sha256').update(bytes).digest('hex');
}

/** SHA-256 over the canonical form of a value — the content address (C4). */
export function contentHashOf(value: unknown): ContentHash {
  return hashBytes(canonicalBytes(value));
}

/**
 * Merkle root over an ordered list of leaf hashes (Doc 04 Snapshot).
 * Domain-separated so a root can never collide with a leaf's preimage space.
 */
export function merkleRootOfHashes(leafHashes: readonly ContentHash[]): ContentHash {
  return contentHashOf({ merkle: 'v1', leaves: leafHashes });
}

/** True iff the value's canonical content hashes to `expected`. */
export function matchesContentHash(value: unknown, expected: ContentHash): boolean {
  return contentHashOf(value) === expected;
}

/** Verifies and throws HashMismatchError on corruption (C33; quarantine is the caller's job). */
export function assertContentHash(value: unknown, expected: ContentHash, what: string): void {
  const actual = contentHashOf(value);
  if (actual !== expected) {
    throw new HashMismatchError(
      `${what}: content hash mismatch`,
      'KEEL_E_MODEL_HASH_MISMATCH',
      { what, expected, actual },
    );
  }
}
