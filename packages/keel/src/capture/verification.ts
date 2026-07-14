/**
 * Verification-replay comparison (Doc 06 A1, Doc 20 §3 internal).
 *
 * Deliberately NOT the Diff Engine (Phase 5): no typed divergences, no
 * ignore rules, no comparator registry — just equality plus naming the
 * first flapping observation path so a rejection is actionable
 * ("stream:stdout/json:$.now", Doc 04 path format).
 */

import type { Observation, Snapshot } from '../model/index.js';
import type { NormalizedExecution } from './normalizer.js';

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

/** First differing path in two parsed JSON documents, JSONPath-ish. */
export function firstJsonDifference(a: unknown, b: unknown, path = '$'): string | undefined {
  if (a === b) return undefined;
  if (typeof a !== typeof b || a === null || b === null) return path;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return path;
    const length = Math.max(a.length, b.length);
    for (let index = 0; index < length; index++) {
      const difference = firstJsonDifference(a[index], b[index], `${path}[${String(index)}]`);
      if (difference !== undefined) return difference;
    }
    return undefined;
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const recordA = a as Record<string, unknown>;
    const recordB = b as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(recordA), ...Object.keys(recordB)])].sort();
    for (const key of keys) {
      const difference = firstJsonDifference(recordA[key], recordB[key], `${path}.${key}`);
      if (difference !== undefined) return difference;
    }
    return undefined;
  }
  return path;
}

const payloadText = (bytes: Uint8Array | undefined): string | undefined =>
  bytes === undefined ? undefined : new TextDecoder().decode(bytes);

/**
 * Names the first flapping path between a baseline-candidate snapshot and a
 * verification run. Only called when the Merkle roots differ, so a
 * difference is guaranteed to exist.
 */
export function findFlappingPath(
  reference: Snapshot,
  referencePayloads: ReadonlyMap<string, Uint8Array>,
  verification: NormalizedExecution,
): string {
  const verificationByIdentity = new Map(
    verification.observations.map((observation) => [observationIdentity(observation), observation]),
  );

  for (const observation of reference.observations) {
    const identity = observationIdentity(observation);
    const counterpart = verificationByIdentity.get(identity);
    verificationByIdentity.delete(identity);
    if (counterpart === undefined) return identity;
    if (JSON.stringify(observation) === JSON.stringify(counterpart)) continue;

    if (observation.kind === 'stream' && counterpart.kind === 'stream') {
      if (observation.interpretation === 'json' && counterpart.interpretation === 'json') {
        const textA = payloadText(referencePayloads.get(observation.contentHash));
        const textB = payloadText(verification.payloads.get(counterpart.contentHash));
        if (textA !== undefined && textB !== undefined) {
          const jsonPath = firstJsonDifference(JSON.parse(textA), JSON.parse(textB));
          if (jsonPath !== undefined) return `${identity}/json:${jsonPath}`;
        }
      }
      return `${identity}/${observation.interpretation}`;
    }
    if (observation.kind === 'exit') return 'exit:outcome';
    return identity;
  }

  // An observation present only in the verification run (e.g. a new fs effect).
  const extra = verificationByIdentity.keys().next();
  return extra.done === true ? 'snapshot' : extra.value;
}
