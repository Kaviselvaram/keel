/**
 * CheckRun & Verdict — the machine-readable result of a check (Doc 04).
 *
 * Structural encoding of the facts-before-annotations law (C11): a Verdict
 * is constructed complete and valid with zero annotations; annotations are
 * merged later via `withAnnotations`, which validates every reference and
 * never touches facts. Every response any adapter emits is a projection of
 * one of these (C12).
 */

import { deepFreeze } from './freeze.js';
import { ValidationError } from './errors.js';
import type { Annotation } from './annotation.js';
import type { Divergence } from './divergence.js';
import { compareDivergences } from './divergence.js';
import type { ContentHash, EntityId, ProbeName } from './identity.js';
import { assertContentHash as assertHashFormat, assertEntityId } from './identity.js';
import { MODEL_SCHEMA_VERSION } from './versions.js';

export interface CheckRun {
  readonly schemaVersion: typeof MODEL_SCHEMA_VERSION;
  readonly id: EntityId;
  readonly baselineId: EntityId;
  readonly startedAtEpochMs: number;
}

export function createCheckRun(input: Omit<CheckRun, 'schemaVersion'>): CheckRun {
  assertEntityId(input.id, 'checkRun.id');
  assertEntityId(input.baselineId, 'checkRun.baselineId');
  if (!Number.isInteger(input.startedAtEpochMs) || input.startedAtEpochMs < 0) {
    throw new ValidationError('startedAtEpochMs must be a non-negative integer', 'KEEL_E_MODEL_INVALID_CHECKRUN', {
      id: input.id,
    });
  }
  return deepFreeze({ schemaVersion: MODEL_SCHEMA_VERSION, ...input });
}

export type VerdictStatus = 'clean' | 'diverged' | 'stale-baseline' | 'error';

/** Per-field staleness report (Doc 06 A4 / ADR-012). */
export interface StalenessFinding {
  readonly field: string;
  readonly expected: string;
  readonly actual: string;
  readonly policy: 'strict' | 'warn';
}

/** Partial-failure detail (Doc 03 §3.9: never a silent subset comparison). */
export interface VerdictError {
  readonly scope: 'partial' | 'total';
  readonly failedProbes: readonly ProbeName[];
  readonly detail: string;
}

/** Phase timings — the user-facing performance report (Doc 10 Part B). */
export interface VerdictTiming {
  readonly replayMs: number;
  readonly diffMs: number;
  readonly classifyMs: number;
  readonly totalMs: number;
}

export interface Verdict {
  readonly schemaVersion: typeof MODEL_SCHEMA_VERSION;
  readonly id: EntityId;
  readonly checkRunId: EntityId;
  readonly baselineId: EntityId;
  readonly status: VerdictStatus;
  /** Sorted by compareDivergences; stableIds unique. */
  readonly divergences: readonly Divergence[];
  /** Empty at construction (facts first, C11); merged via withAnnotations. */
  readonly annotations: readonly Annotation[];
  /** probeName → replay snapshot contentHash. */
  readonly replaySnapshots: Readonly<Record<ProbeName, ContentHash>>;
  readonly codeDiffRef: ContentHash | null;
  /** ADR-013: the working tree changed during the check. */
  readonly treeMutated: boolean;
  /** Warn-level provenance drift (e.g. ancestor-drift) or the strict findings behind stale-baseline. */
  readonly staleness: readonly StalenessFinding[];
  readonly error: VerdictError | null;
  readonly timing: VerdictTiming;
}

export interface VerdictInput {
  readonly id: EntityId;
  readonly checkRunId: EntityId;
  readonly baselineId: EntityId;
  readonly status: VerdictStatus;
  readonly divergences: readonly Divergence[];
  readonly replaySnapshots: Readonly<Record<ProbeName, ContentHash>>;
  readonly codeDiffRef: ContentHash | null;
  readonly treeMutated: boolean;
  readonly staleness: readonly StalenessFinding[];
  readonly error: VerdictError | null;
  readonly timing: VerdictTiming;
}

function validateStatusCoherence(input: VerdictInput): void {
  const fail = (rule: string): never => {
    throw new ValidationError(`verdict status '${input.status}' ${rule}`, 'KEEL_E_MODEL_INVALID_VERDICT', {
      id: input.id,
      status: input.status,
    });
  };
  switch (input.status) {
    case 'clean':
      if (input.divergences.length > 0) fail('cannot carry divergences');
      if (input.error !== null) fail('cannot carry an error');
      return;
    case 'diverged':
      if (input.divergences.length === 0) fail('requires at least one divergence');
      return;
    case 'stale-baseline':
      if (input.divergences.length > 0) fail('cannot carry divergences (nothing was compared)');
      if (input.staleness.length === 0) fail('requires staleness findings');
      return;
    case 'error':
      if (input.error === null) fail('requires error detail');
      return;
  }
}

export function createVerdict(input: VerdictInput): Verdict {
  assertEntityId(input.id, 'verdict.id');
  assertEntityId(input.checkRunId, 'verdict.checkRunId');
  assertEntityId(input.baselineId, 'verdict.baselineId');
  validateStatusCoherence(input);

  const seen = new Set<ContentHash>();
  for (const [index, divergence] of input.divergences.entries()) {
    if (seen.has(divergence.stableId)) {
      throw new ValidationError('duplicate divergence stableId', 'KEEL_E_MODEL_DUPLICATE_DIVERGENCE', {
        id: input.id,
        stableId: divergence.stableId,
      });
    }
    seen.add(divergence.stableId);
    if (index > 0 && compareDivergences(input.divergences[index - 1] as Divergence, divergence) >= 0) {
      throw new ValidationError(
        'divergences not in canonical order (Doc 06 B1 invariant 2)',
        'KEEL_E_MODEL_DIVERGENCES_UNORDERED',
        { id: input.id, index },
      );
    }
  }
  for (const hash of Object.values(input.replaySnapshots)) {
    assertHashFormat(hash, 'replaySnapshots value');
  }
  if (input.codeDiffRef !== null) assertHashFormat(input.codeDiffRef, 'codeDiffRef');

  return deepFreeze({ schemaVersion: MODEL_SCHEMA_VERSION, ...input, annotations: [] });
}

/**
 * Merges annotations into a persisted verdict (append-only, C11).
 * Every annotation must reference an existing divergence, one annotation
 * per divergence — dangling or duplicate references are broken
 * relationships and rejected.
 */
export function withAnnotations(verdict: Verdict, annotations: readonly Annotation[]): Verdict {
  if (verdict.annotations.length > 0) {
    throw new ValidationError('verdict is already annotated (annotation is one-shot, append-only)', 'KEEL_E_MODEL_INVALID_TRANSITION', {
      id: verdict.id,
    });
  }
  const known = new Set(verdict.divergences.map((d) => d.stableId));
  const annotated = new Set<ContentHash>();
  for (const annotation of annotations) {
    if (!known.has(annotation.divergenceStableId)) {
      throw new ValidationError(
        'annotation references a divergence not in this verdict',
        'KEEL_E_MODEL_INVALID_RELATIONSHIP',
        { id: verdict.id, stableId: annotation.divergenceStableId },
      );
    }
    if (annotated.has(annotation.divergenceStableId)) {
      throw new ValidationError('duplicate annotation for divergence', 'KEEL_E_MODEL_INVALID_RELATIONSHIP', {
        id: verdict.id,
        stableId: annotation.divergenceStableId,
      });
    }
    annotated.add(annotation.divergenceStableId);
  }
  return deepFreeze({ ...verdict, annotations: [...annotations] });
}
