/**
 * The Diff Engine (Doc 20 §5): pure structural comparison of two Snapshots
 * into typed, deterministically ordered Divergences.
 *
 * Purity contract: imports model ONLY; no I/O, no clock, no logging, no
 * configuration loading. Payload content arrives as an input map. Any throw
 * here is an invariant violation — fatal by design so it gets fixed
 * (plain Error: shared/ is outside this module's dependency budget).
 *
 * Value refs are content addresses (sha-256 of the canonical value) — they
 * identify values; presence in the CAS is only guaranteed for whole stream
 * payloads in v1.
 */

import {
  compareDivergences,
  contentHashOf,
  createDivergence,
} from '../model/index.js';
import type {
  ContentHash,
  Divergence,
  DivergenceKind,
  Observation,
  Snapshot,
} from '../model/index.js';
import { compileIgnoreRules } from './ignore-rules.js';
import { compareJson } from './json-compare.js';
import type { JsonDifference } from './json-compare.js';

export interface DiffOptions {
  /** Stream payload bytes by content hash (union of both sides; callers preload). */
  readonly payloads: ReadonlyMap<ContentHash, Uint8Array>;
  /** v1 rule language: `*`-globs over formatted divergence paths (see ignore-rules.ts). */
  readonly ignoreRules?: readonly string[];
  /** Size ceiling (Doc 12): exceeding it is an invariant violation, not silent truncation. */
  readonly maxDivergences?: number;
}

const DEFAULT_MAX_DIVERGENCES = 1_000;
const decoder = new TextDecoder();

function observationIdentity(observation: Observation): string {
  switch (observation.kind) {
    case 'exit':
      return 'exit';
    case 'stream':
      return `stream:${observation.stream}`;
    case 'fs-effect':
      return `fs-effect:${observation.path}`;
    case 'net-call':
      return `net-call:${String(observation.sequence)}`;
  }
}

const refOf = (value: unknown): ContentHash => contentHashOf(value);

function parsePayload(
  payloads: ReadonlyMap<ContentHash, Uint8Array>,
  hash: ContentHash,
): unknown | undefined {
  const bytes = payloads.get(hash);
  if (bytes === undefined) return undefined;
  return JSON.parse(decoder.decode(bytes)) as unknown;
}

export function diffSnapshots(
  baseline: Snapshot,
  candidate: Snapshot,
  options: DiffOptions,
): readonly Divergence[] {
  if (baseline.probeName !== candidate.probeName) {
    throw new Error(
      `diffSnapshots invariant: probe names differ ('${baseline.probeName}' vs '${candidate.probeName}')`,
    );
  }
  // Merkle short-circuit (Doc 20 §5): identical roots need no descent.
  if (baseline.contentHash === candidate.contentHash) return [];

  const probeName = baseline.probeName;
  const ceiling = options.maxDivergences ?? DEFAULT_MAX_DIVERGENCES;
  const ignored = compileIgnoreRules(options.ignoreRules ?? []);
  const divergences: Divergence[] = [];

  const emit = (
    observation: Observation['kind'],
    locator: string,
    kind: DivergenceKind,
    baselineValueRef: ContentHash | null,
    candidateValueRef: ContentHash | null,
  ): void => {
    if (ignored(`${observation}:${locator}`)) return;
    if (divergences.length >= ceiling) {
      throw new Error(
        `diffSnapshots invariant: divergence ceiling (${String(ceiling)}) exceeded for probe '${probeName}'`,
      );
    }
    divergences.push(
      createDivergence({
        probeName,
        path: { observation, locator },
        kind,
        baselineValueRef,
        candidateValueRef,
      }),
    );
  };

  const candidateByIdentity = new Map(
    candidate.observations.map((observation) => [observationIdentity(observation), observation]),
  );

  for (const base of baseline.observations) {
    const identity = observationIdentity(base);
    const other = candidateByIdentity.get(identity);
    candidateByIdentity.delete(identity);

    switch (base.kind) {
      case 'exit': {
        // Exit observations exist in every snapshot; a missing one is impossible by model validation.
        if (other === undefined || other.kind !== 'exit') {
          throw new Error('diffSnapshots invariant: candidate snapshot has no exit observation');
        }
        if (contentHashOf(base.outcome) === contentHashOf(other.outcome)) break;
        const failed = ['timeout', 'cancelled', 'output-limit'].includes(other.outcome.kind);
        emit('exit', 'outcome', failed ? 'probe-failed' : 'exit-changed', refOf(base.outcome), refOf(other.outcome));
        break;
      }
      case 'stream': {
        if (other === undefined || other.kind !== 'stream') {
          throw new Error(`diffSnapshots invariant: candidate lost stream '${base.stream}'`);
        }
        if (base.contentHash === other.contentHash) break;
        if (base.interpretation === 'json' && other.interpretation === 'json') {
          const baseTree = parsePayload(options.payloads, base.contentHash);
          const otherTree = parsePayload(options.payloads, other.contentHash);
          if (baseTree !== undefined && otherTree !== undefined) {
            const jsonDifferences: JsonDifference[] = [];
            compareJson(baseTree, otherTree, '$', (difference) => jsonDifferences.push(difference));
            for (const difference of jsonDifferences) {
              const locator = `${base.stream}/json:${difference.locator}`;
              switch (difference.kind) {
                case 'entry-added':
                  emit('stream', locator, 'entry-added', null, refOf(difference.candidateValue));
                  break;
                case 'entry-removed':
                  emit('stream', locator, 'entry-removed', refOf(difference.baselineValue), null);
                  break;
                case 'order-changed':
                  emit('stream', locator, 'order-changed', base.contentHash, other.contentHash);
                  break;
                default:
                  emit(
                    'stream',
                    locator,
                    difference.kind,
                    refOf(difference.baselineValue),
                    refOf(difference.candidateValue),
                  );
              }
            }
            break;
          }
        }
        // Interpretation changed, non-JSON, or payloads unavailable: whole-stream fact.
        const locator =
          base.interpretation === other.interpretation
            ? `${base.stream}/${base.interpretation}`
            : `${base.stream}/interpretation`;
        emit(
          'stream',
          locator,
          base.interpretation === other.interpretation ? 'value-changed' : 'shape-changed',
          base.contentHash,
          other.contentHash,
        );
        break;
      }
      case 'fs-effect': {
        const baseRef = base.contentHash ?? refOf(base);
        if (other === undefined) {
          emit('fs-effect', base.path, 'effect-removed', baseRef, null);
        } else if (other.kind === 'fs-effect') {
          const otherRef = other.contentHash ?? refOf(other);
          if (base.effect !== other.effect || baseRef !== otherRef) {
            emit('fs-effect', base.path, 'effect-changed', baseRef, otherRef);
          }
        }
        break;
      }
      case 'net-call': {
        const baseRef = refOf(base);
        if (other === undefined) {
          emit('net-call', String(base.sequence), 'effect-removed', baseRef, null);
        } else if (other.kind === 'net-call' && refOf(other) !== baseRef) {
          emit('net-call', String(base.sequence), 'effect-changed', baseRef, refOf(other));
        }
        break;
      }
    }
  }

  // Candidate-only observations: new effects.
  for (const extra of candidateByIdentity.values()) {
    switch (extra.kind) {
      case 'fs-effect':
        emit('fs-effect', extra.path, 'effect-added', null, extra.contentHash ?? refOf(extra));
        break;
      case 'net-call':
        // A call the baseline never recorded (Doc 03 §3.3: a fact, not an error).
        emit('net-call', String(extra.sequence), 'unrecorded-effect', null, refOf(extra));
        break;
      case 'exit':
      case 'stream':
        throw new Error(`diffSnapshots invariant: candidate grew a '${extra.kind}' observation`);
    }
  }

  return [...divergences].sort(compareDivergences);
}
