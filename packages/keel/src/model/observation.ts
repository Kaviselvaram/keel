/**
 * Observation — one recorded fact from an execution (Doc 04).
 *
 * Tagged union; each variant has its own canonical form. `funcIO` (deep
 * mode) is reserved for v2 by Doc 04 and deliberately not constructible.
 * Canonical ordering within a snapshot (Doc 04 Snapshot): exit, then
 * streams (stdout before stderr), then fs effects sorted by path, then
 * net calls by sequence.
 */

import { ValidationError } from './errors.js';
import type { ContentHash } from './identity.js';
import { assertContentHash as assertHashFormat } from './identity.js';

export type ExitOutcome =
  | { readonly kind: 'exited'; readonly code: number }
  | { readonly kind: 'signaled'; readonly signal: string }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'output-limit' };

export type StreamName = 'stdout' | 'stderr';

/** How capture interpreted the stream (Doc 06 A3 structure sniffing — recorded so replay uses the same interpretation). */
export type StreamInterpretation = 'text' | 'json' | 'ndjson' | 'binary';

export type Observation =
  | { readonly kind: 'exit'; readonly outcome: ExitOutcome }
  | {
      readonly kind: 'stream';
      readonly stream: StreamName;
      /** Hash of the normalized content (CAS ref). */
      readonly contentHash: ContentHash;
      readonly byteLength: number;
      readonly interpretation: StreamInterpretation;
    }
  | {
      readonly kind: 'fs-effect';
      /** Repo-relative POSIX-separated path (normalization is capture's job; format is validated here). */
      readonly path: string;
      readonly effect: 'created' | 'modified' | 'deleted';
      /** Absent iff effect is 'deleted'. */
      readonly contentHash?: ContentHash;
    }
  | {
      readonly kind: 'net-call';
      readonly sequence: number;
      readonly request: {
        readonly method: string;
        readonly url: string;
        readonly bodyHash?: ContentHash;
      };
      readonly response: {
        readonly status: number;
        readonly bodyHash?: ContentHash;
      };
    };

export type ObservationKind = Observation['kind'];

const KIND_ORDER: Readonly<Record<ObservationKind, number>> = {
  exit: 0,
  stream: 1,
  'fs-effect': 2,
  'net-call': 3,
};

const STREAM_ORDER: Readonly<Record<StreamName, number>> = { stdout: 0, stderr: 1 };

/** Total order defining canonical observation sequence within a snapshot. */
export function compareObservations(a: Observation, b: Observation): number {
  const byKind = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  if (byKind !== 0) return byKind;
  if (a.kind === 'stream' && b.kind === 'stream') {
    return STREAM_ORDER[a.stream] - STREAM_ORDER[b.stream];
  }
  if (a.kind === 'fs-effect' && b.kind === 'fs-effect') {
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  }
  if (a.kind === 'net-call' && b.kind === 'net-call') {
    return a.sequence - b.sequence;
  }
  return 0;
}

function validateOne(observation: Observation, index: number): void {
  const at = { index };
  switch (observation.kind) {
    case 'exit':
      if (observation.outcome.kind === 'exited' && !Number.isInteger(observation.outcome.code)) {
        throw new ValidationError('exit code must be an integer', 'KEEL_E_MODEL_INVALID_OBSERVATION', at);
      }
      return;
    case 'stream':
      assertHashFormat(observation.contentHash, `observations[${String(index)}].contentHash`);
      if (!Number.isInteger(observation.byteLength) || observation.byteLength < 0) {
        throw new ValidationError('stream byteLength must be a non-negative integer', 'KEEL_E_MODEL_INVALID_OBSERVATION', at);
      }
      return;
    case 'fs-effect': {
      const { path, effect, contentHash } = observation;
      if (path.length === 0 || path.startsWith('/') || path.includes('\\') || path.split('/').includes('..')) {
        throw new ValidationError(
          'fs-effect path must be repo-relative, POSIX-separated, without ..',
          'KEEL_E_MODEL_INVALID_OBSERVATION',
          { ...at, path },
        );
      }
      if (effect === 'deleted' && contentHash !== undefined) {
        throw new ValidationError('deleted fs-effect must not carry a contentHash', 'KEEL_E_MODEL_INVALID_OBSERVATION', { ...at, path });
      }
      if (effect !== 'deleted') {
        if (contentHash === undefined) {
          throw new ValidationError(`${effect} fs-effect requires a contentHash`, 'KEEL_E_MODEL_INVALID_OBSERVATION', { ...at, path });
        }
        assertHashFormat(contentHash, `observations[${String(index)}].contentHash`);
      }
      return;
    }
    case 'net-call':
      if (!Number.isInteger(observation.sequence) || observation.sequence < 0) {
        throw new ValidationError('net-call sequence must be a non-negative integer', 'KEEL_E_MODEL_INVALID_OBSERVATION', at);
      }
      if (!Number.isInteger(observation.response.status)) {
        throw new ValidationError('net-call status must be an integer', 'KEEL_E_MODEL_INVALID_OBSERVATION', at);
      }
      return;
  }
}

/**
 * Validates an observation list as a canonical set: each observation valid,
 * strictly ascending in canonical order (which also enforces uniqueness of
 * exit, stream names, fs paths, and net sequences), at most one exit.
 */
export function validateObservations(observations: readonly Observation[]): void {
  observations.forEach(validateOne);
  for (let i = 1; i < observations.length; i++) {
    const previous = observations[i - 1] as Observation;
    const current = observations[i] as Observation;
    if (compareObservations(previous, current) >= 0) {
      throw new ValidationError(
        `observations not in strict canonical order at index ${String(i)}`,
        'KEEL_E_MODEL_OBSERVATIONS_UNORDERED',
        { index: i, previousKind: previous.kind, currentKind: current.kind },
      );
    }
  }
}
