/**
 * Divergence — one typed, structural difference between baseline and replay
 * snapshots. A deterministic fact (Doc 04; taxonomy Doc 06 B3, closed and
 * versioned). stableId is content-derived from (probe, path, kind) so
 * suppressions and prior classifications survive re-runs.
 */

import { deepFreeze } from './freeze.js';
import { ValidationError } from './errors.js';
import { contentHashOf } from './hashing.js';
import type { ContentHash, ProbeName } from './identity.js';
import { assertProbeName } from './identity.js';
import type { ObservationKind } from './observation.js';

/** Closed taxonomy (Doc 06 B3). Additions are minor-version events with explicit handling in every consumer. */
export const DIVERGENCE_KINDS = [
  'value-changed',
  'shape-changed',
  'entry-added',
  'entry-removed',
  'order-changed',
  'effect-added',
  'effect-removed',
  'effect-changed',
  'unrecorded-effect',
  'exit-changed',
  'probe-failed',
] as const;

export type DivergenceKind = (typeof DIVERGENCE_KINDS)[number];

export function isDivergenceKind(value: string): value is DivergenceKind {
  return (DIVERGENCE_KINDS as readonly string[]).includes(value);
}

/** Structured pointer into a snapshot (Doc 04), e.g. stream:stdout + json:$.items[3].price. */
export interface DivergencePath {
  readonly observation: ObservationKind;
  readonly locator: string;
}

export function formatDivergencePath(path: DivergencePath): string {
  return `${path.observation}:${path.locator}`;
}

export interface Divergence {
  readonly probeName: ProbeName;
  readonly path: DivergencePath;
  readonly kind: DivergenceKind;
  /** CAS refs, not inline values (values may be large). Null where the side has no value. */
  readonly baselineValueRef: ContentHash | null;
  readonly candidateValueRef: ContentHash | null;
  readonly stableId: ContentHash;
}

export type DivergenceInput = Omit<Divergence, 'stableId'>;

/** Content-derived identity bridging check runs (Doc 04 lifecycle rule 3). */
export function divergenceStableId(
  probeName: ProbeName,
  path: DivergencePath,
  kind: DivergenceKind,
): ContentHash {
  return contentHashOf({ probeName, path: formatDivergencePath(path), kind });
}

/** Which sides must be present per kind: added → no baseline; removed → no candidate. */
function validateRefPresence(input: DivergenceInput): void {
  const fail = (rule: string): never => {
    throw new ValidationError(
      `divergence kind '${input.kind}' ${rule}`,
      'KEEL_E_MODEL_INVALID_DIVERGENCE',
      { probeName: input.probeName, kind: input.kind, path: formatDivergencePath(input.path) },
    );
  };
  switch (input.kind) {
    case 'entry-added':
    case 'effect-added':
    case 'unrecorded-effect':
      if (input.baselineValueRef !== null) fail('must not carry a baseline value');
      if (input.candidateValueRef === null) fail('requires a candidate value');
      return;
    case 'entry-removed':
    case 'effect-removed':
      if (input.candidateValueRef !== null) fail('must not carry a candidate value');
      if (input.baselineValueRef === null) fail('requires a baseline value');
      return;
    default:
      if (input.baselineValueRef === null && input.candidateValueRef === null) {
        fail('requires at least one value ref');
      }
  }
}

export function createDivergence(input: DivergenceInput): Divergence {
  assertProbeName(input.probeName);
  if (!isDivergenceKind(input.kind)) {
    throw new ValidationError(`unknown divergence kind '${input.kind as string}'`, 'KEEL_E_MODEL_INVALID_DIVERGENCE', {
      kind: input.kind,
    });
  }
  if (input.path.locator.length === 0) {
    throw new ValidationError('divergence locator must be non-empty', 'KEEL_E_MODEL_INVALID_DIVERGENCE', {
      probeName: input.probeName,
    });
  }
  validateRefPresence(input);
  return deepFreeze({
    ...input,
    stableId: divergenceStableId(input.probeName, input.path, input.kind),
  });
}

/**
 * Deterministic verdict ordering (Doc 06 B1 invariant 2):
 * (probeName, observation kind order, locator, kind).
 */
export function compareDivergences(a: Divergence, b: Divergence): number {
  if (a.probeName !== b.probeName) return a.probeName < b.probeName ? -1 : 1;
  const pathA = formatDivergencePath(a.path);
  const pathB = formatDivergencePath(b.path);
  if (pathA !== pathB) return pathA < pathB ? -1 : 1;
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  return 0;
}
