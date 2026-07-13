import { describe, expect, it } from 'vitest';
import {
  createCapturingBaseline,
  rejectBaseline,
  sealBaseline,
  withSnapshotRef,
} from '../baseline.js';
import { ValidationError } from '../errors.js';
import { HASH_A, HASH_B, ULID_A, validProvenance } from './fixtures.js';

const capturing = () =>
  createCapturingBaseline({ id: ULID_A, label: 'main', provenance: validProvenance });

describe('baseline lifecycle (capturing -> sealed | rejected)', () => {
  it('captures, accumulates snapshots, seals', () => {
    let baseline = capturing();
    baseline = withSnapshotRef(baseline, 'probe-a', HASH_A);
    baseline = withSnapshotRef(baseline, 'probe-b', HASH_B);
    const sealed = sealBaseline(baseline, 1_720_000_000_000);
    expect(sealed.status).toBe('sealed');
    expect(sealed.sealedAtEpochMs).toBe(1_720_000_000_000);
    expect(Object.keys(sealed.snapshots)).toEqual(['probe-a', 'probe-b']);
  });

  it('rejects with the flapping path named (Doc 06 A1)', () => {
    const rejected = rejectBaseline(withSnapshotRef(capturing(), 'p', HASH_A), {
      probeName: 'p',
      flappingPath: 'stream:stdout/json:$.now',
      reason: 'value differs across verification replays',
    });
    expect(rejected.status).toBe('rejected');
    expect(rejected.rejection?.flappingPath).toContain('stdout');
  });

  it('refuses every invalid transition', () => {
    const sealed = sealBaseline(withSnapshotRef(capturing(), 'p', HASH_A), 1);
    expect(() => sealBaseline(sealed, 2)).toThrowError(ValidationError);
    expect(() => withSnapshotRef(sealed, 'q', HASH_B)).toThrowError(ValidationError);
    expect(() =>
      rejectBaseline(sealed, { probeName: 'p', flappingPath: 'x', reason: 'y' }),
    ).toThrowError(ValidationError);
  });

  it('refuses sealing with no snapshots and duplicate probe ownership', () => {
    expect(() => sealBaseline(capturing(), 1)).toThrowError(ValidationError);
    const withOne = withSnapshotRef(capturing(), 'p', HASH_A);
    expect(() => withSnapshotRef(withOne, 'p', HASH_B)).toThrowError(ValidationError);
  });

  it('validates identity and label at construction', () => {
    expect(() =>
      createCapturingBaseline({ id: 'not-a-ulid', label: 'x', provenance: validProvenance }),
    ).toThrowError(ValidationError);
    expect(() =>
      createCapturingBaseline({ id: ULID_A, label: '', provenance: validProvenance }),
    ).toThrowError(ValidationError);
  });

  it('transitions return new frozen values; originals are untouched (C32)', () => {
    const original = withSnapshotRef(capturing(), 'p', HASH_A);
    const sealed = sealBaseline(original, 1);
    expect(original.status).toBe('capturing');
    expect(sealed).not.toBe(original);
    expect(Object.isFrozen(sealed)).toBe(true);
    expect(Object.isFrozen(sealed.provenance)).toBe(true);
  });
});
