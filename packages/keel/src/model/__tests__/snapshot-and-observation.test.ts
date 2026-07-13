import { describe, expect, it } from 'vitest';
import { HashMismatchError, ValidationError } from '../errors.js';
import { compareObservations, validateObservations } from '../observation.js';
import type { Observation } from '../observation.js';
import { createSnapshot, snapshotMerkleRoot, verifySnapshotIntegrity } from '../snapshot.js';
import type { Snapshot } from '../snapshot.js';
import { HASH_A, HASH_B, validObservations } from './fixtures.js';

const baseInput = {
  probeName: 'api-list-users',
  probeSpecHash: HASH_A,
  normalizationRulesetVersion: 'rules/1',
  observations: validObservations,
};

describe('observations', () => {
  it('accepts a valid canonical set', () => {
    expect(() => validateObservations(validObservations)).not.toThrow();
  });

  it('rejects out-of-order and duplicate entries (strict canonical order)', () => {
    const swapped = [validObservations[1], validObservations[0]] as Observation[];
    expect(() => validateObservations(swapped)).toThrowError(ValidationError);
    const duplicated = [validObservations[0], validObservations[0]] as Observation[];
    expect(() => validateObservations(duplicated)).toThrowError(ValidationError);
  });

  it('rejects absolute, backslashed, and parent-escaping fs paths', () => {
    for (const path of ['/etc/passwd', 'out\\win.txt', '../outside', 'a/../b']) {
      expect(() =>
        validateObservations([{ kind: 'fs-effect', path, effect: 'created', contentHash: HASH_A }]),
      ).toThrowError(ValidationError);
    }
  });

  it('enforces contentHash presence rules per fs effect', () => {
    expect(() =>
      validateObservations([{ kind: 'fs-effect', path: 'x', effect: 'deleted', contentHash: HASH_A }]),
    ).toThrowError(ValidationError);
    expect(() =>
      validateObservations([{ kind: 'fs-effect', path: 'x', effect: 'modified' }]),
    ).toThrowError(ValidationError);
  });

  it('orders kinds exit < stdout < stderr < fs-by-path < net-by-sequence', () => {
    const sorted = [...validObservations].sort(compareObservations);
    expect(sorted).toEqual(validObservations);
  });
});

describe('snapshot', () => {
  it('computes a Merkle root at construction; equal content gives equal roots', () => {
    const first = createSnapshot(baseInput);
    const second = createSnapshot({ ...baseInput });
    expect(first.contentHash).toBe(second.contentHash);
    expect(first.contentHash).toBe(snapshotMerkleRoot(validObservations));
  });

  it('root changes when any observation changes', () => {
    const altered = validObservations.map((observation) =>
      observation.kind === 'stream' && observation.stream === 'stdout'
        ? { ...observation, contentHash: HASH_B }
        : observation,
    );
    expect(createSnapshot({ ...baseInput, observations: altered }).contentHash).not.toBe(
      createSnapshot(baseInput).contentHash,
    );
  });

  it('is deeply frozen', () => {
    const snapshot = createSnapshot(baseInput);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.observations)).toBe(true);
    expect(Object.isFrozen(snapshot.observations[0])).toBe(true);
  });

  it('verifySnapshotIntegrity detects tampering (C33)', () => {
    const genuine = createSnapshot(baseInput);
    const tampered: Snapshot = { ...genuine, contentHash: HASH_B };
    expect(() => verifySnapshotIntegrity(tampered)).toThrowError(HashMismatchError);
    expect(() => verifySnapshotIntegrity(genuine)).not.toThrow();
  });

  it('rejects invalid probe names and hash formats', () => {
    expect(() => createSnapshot({ ...baseInput, probeName: 'has space' })).toThrowError(ValidationError);
    expect(() => createSnapshot({ ...baseInput, probeSpecHash: 'nope' })).toThrowError(ValidationError);
  });
});
