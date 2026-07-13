import { describe, expect, it } from 'vitest';
import { createAnnotation } from '../annotation.js';
import {
  compareDivergences,
  createDivergence,
  divergenceStableId,
  DIVERGENCE_KINDS,
  formatDivergencePath,
} from '../divergence.js';
import type { DivergenceInput, DivergenceKind } from '../divergence.js';
import { ValidationError } from '../errors.js';
import { createCheckRun, createVerdict, withAnnotations } from '../verdict.js';
import type { VerdictInput } from '../verdict.js';
import { HASH_A, HASH_B, ULID_A, ULID_B } from './fixtures.js';

const divergence = (overrides: Partial<DivergenceInput> = {}) =>
  createDivergence({
    probeName: 'api-list-users',
    path: { observation: 'stream', locator: 'stdout/json:$.items[3].price' },
    kind: 'value-changed',
    baselineValueRef: HASH_A,
    candidateValueRef: HASH_B,
    ...overrides,
  });

const timing = { replayMs: 100, diffMs: 5, classifyMs: 0, totalMs: 120 };

const verdictInput = (overrides: Partial<VerdictInput> = {}): VerdictInput => ({
  id: ULID_A,
  checkRunId: ULID_B,
  baselineId: ULID_B,
  status: 'diverged',
  divergences: [divergence()],
  replaySnapshots: { 'api-list-users': HASH_A },
  codeDiffRef: null,
  treeMutated: false,
  staleness: [],
  error: null,
  timing,
  ...overrides,
});

describe('divergence', () => {
  it('stableId is content-derived and stable across runs (Doc 04)', () => {
    expect(divergence().stableId).toBe(divergence().stableId);
    expect(divergence().stableId).toBe(
      divergenceStableId('api-list-users', { observation: 'stream', locator: 'stdout/json:$.items[3].price' }, 'value-changed'),
    );
    expect(divergence({ kind: 'shape-changed' }).stableId).not.toBe(divergence().stableId);
  });

  it('taxonomy is closed (Doc 06 B3)', () => {
    expect(DIVERGENCE_KINDS).toHaveLength(11);
    expect(() => divergence({ kind: 'vibe-changed' as DivergenceKind })).toThrowError(ValidationError);
  });

  it('enforces ref presence per kind', () => {
    expect(() => divergence({ kind: 'entry-added', baselineValueRef: HASH_A })).toThrowError(ValidationError);
    expect(() => divergence({ kind: 'entry-removed', candidateValueRef: HASH_B })).toThrowError(ValidationError);
    expect(() => divergence({ baselineValueRef: null, candidateValueRef: null })).toThrowError(ValidationError);
    expect(divergence({ kind: 'unrecorded-effect', baselineValueRef: null }).candidateValueRef).toBe(HASH_B);
  });

  it('formats paths as kind:locator', () => {
    expect(formatDivergencePath({ observation: 'exit', locator: 'code' })).toBe('exit:code');
  });
});

describe('verdict', () => {
  it('status coherence: clean forbids divergences; diverged requires them; stale requires findings; error requires detail', () => {
    expect(() => createVerdict(verdictInput({ status: 'clean' }))).toThrowError(ValidationError);
    expect(createVerdict(verdictInput({ status: 'clean', divergences: [] })).status).toBe('clean');
    expect(() => createVerdict(verdictInput({ divergences: [] }))).toThrowError(ValidationError);
    expect(() => createVerdict(verdictInput({ status: 'stale-baseline', divergences: [] }))).toThrowError(ValidationError);
    expect(
      createVerdict(
        verdictInput({
          status: 'stale-baseline',
          divergences: [],
          staleness: [{ field: 'configHash', expected: 'a', actual: 'b', policy: 'strict' }],
        }),
      ).status,
    ).toBe('stale-baseline');
    expect(() => createVerdict(verdictInput({ status: 'error' }))).toThrowError(ValidationError);
  });

  it('rejects duplicate stableIds and unordered divergences (Doc 06 B1)', () => {
    expect(() => createVerdict(verdictInput({ divergences: [divergence(), divergence()] }))).toThrowError(
      ValidationError,
    );
    const first = divergence();
    const second = divergence({ kind: 'shape-changed' });
    const ordered = [first, second].sort(compareDivergences);
    expect(createVerdict(verdictInput({ divergences: ordered })).divergences).toHaveLength(2);
    expect(() =>
      createVerdict(verdictInput({ divergences: [...ordered].reverse() })),
    ).toThrowError(ValidationError);
  });

  it('is constructed with zero annotations — facts before annotations (C11)', () => {
    expect(createVerdict(verdictInput()).annotations).toEqual([]);
  });

  it('withAnnotations validates relationships and is one-shot', () => {
    const verdict = createVerdict(verdictInput());
    const annotation = createAnnotation({
      divergenceStableId: verdict.divergences[0]?.stableId ?? '',
      label: 'collateral',
      confidence: 0.8,
      attribution: { tier: 'heuristic', ruleId: 'untouched-file-collateral' },
      rationale: 'probe exercises a file the diff never touched',
      evidencePacketHash: HASH_A,
    });
    const annotated = withAnnotations(verdict, [annotation]);
    expect(annotated.annotations).toHaveLength(1);
    expect(verdict.annotations).toHaveLength(0);

    const dangling = createAnnotation({ ...annotation, divergenceStableId: HASH_B });
    expect(() => withAnnotations(verdict, [dangling])).toThrowError(ValidationError);
    expect(() => withAnnotations(verdict, [annotation, annotation])).toThrowError(ValidationError);
    expect(() => withAnnotations(annotated, [annotation])).toThrowError(ValidationError);
  });

  it('createCheckRun validates ids', () => {
    expect(() => createCheckRun({ id: 'bad', baselineId: ULID_B, startedAtEpochMs: 1 })).toThrowError(
      ValidationError,
    );
    expect(createCheckRun({ id: ULID_A, baselineId: ULID_B, startedAtEpochMs: 1 }).id).toBe(ULID_A);
  });
});
