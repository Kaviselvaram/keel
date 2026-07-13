/**
 * Snapshot — the comparable unit: normalized observations for one execution
 * of one probe (Doc 04). contentHash is a Merkle root over observation
 * hashes, giving O(1) equality and subtree short-circuiting in diff.
 */

import { deepFreeze } from './freeze.js';
import { contentHashOf, merkleRootOfHashes } from './hashing.js';
import { HashMismatchError } from './errors.js';
import type { ContentHash, ProbeName } from './identity.js';
import { assertContentHash as assertHashFormat, assertProbeName } from './identity.js';
import type { Observation } from './observation.js';
import { validateObservations } from './observation.js';
import { MODEL_SCHEMA_VERSION } from './versions.js';

export interface Snapshot {
  readonly schemaVersion: typeof MODEL_SCHEMA_VERSION;
  readonly probeName: ProbeName;
  readonly probeSpecHash: ContentHash;
  readonly normalizationRulesetVersion: string;
  /** In strict canonical order (validated at construction). */
  readonly observations: readonly Observation[];
  /** Merkle root over per-observation content hashes. */
  readonly contentHash: ContentHash;
}

export interface SnapshotInput {
  readonly probeName: ProbeName;
  readonly probeSpecHash: ContentHash;
  readonly normalizationRulesetVersion: string;
  readonly observations: readonly Observation[];
}

export function observationHash(observation: Observation): ContentHash {
  return contentHashOf(observation);
}

/** The Merkle root a snapshot with these observations must carry. */
export function snapshotMerkleRoot(observations: readonly Observation[]): ContentHash {
  return merkleRootOfHashes(observations.map(observationHash));
}

export function createSnapshot(input: SnapshotInput): Snapshot {
  assertProbeName(input.probeName);
  assertHashFormat(input.probeSpecHash, 'probeSpecHash');
  validateObservations(input.observations);
  return deepFreeze({
    schemaVersion: MODEL_SCHEMA_VERSION,
    probeName: input.probeName,
    probeSpecHash: input.probeSpecHash,
    normalizationRulesetVersion: input.normalizationRulesetVersion,
    observations: input.observations,
    contentHash: snapshotMerkleRoot(input.observations),
  });
}

/** Integrity check for snapshots read back from storage (C33). */
export function verifySnapshotIntegrity(snapshot: Snapshot): void {
  validateObservations(snapshot.observations);
  const expected = snapshotMerkleRoot(snapshot.observations);
  if (expected !== snapshot.contentHash) {
    throw new HashMismatchError('snapshot content hash mismatch', 'KEEL_E_MODEL_HASH_MISMATCH', {
      probeName: snapshot.probeName,
      expected,
      recorded: snapshot.contentHash,
    });
  }
}
