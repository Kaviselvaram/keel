/**
 * ExecutionRecord — one concrete run of a probe (Doc 04). Ephemeral by
 * default; persisted inside capture provenance or on failure.
 *
 * Wall-clock fields (startedAtEpochMs, durationMs) are recorded but
 * excluded from canonical content by Doc 04 — `executionContentHash`
 * hashes only the behavior-bearing subset (L4: time never enters canonical
 * content, C7).
 */

import { deepFreeze } from './freeze.js';
import { contentHashOf } from './hashing.js';
import type { ContentHash, ProbeName } from './identity.js';
import { assertProbeName } from './identity.js';
import type { ExitOutcome } from './observation.js';
import { ValidationError } from './errors.js';
import { MODEL_SCHEMA_VERSION } from './versions.js';

export interface RunnerDescriptor {
  readonly id: string;
  readonly runtimeVersion: string;
  readonly os: string;
  readonly arch: string;
}

/** What the interceptors tamed during the run (Doc 04). */
export interface InterceptorReport {
  readonly clockEpochMs?: number;
  readonly rngSeed?: string;
  readonly recordedNetCalls: number;
  readonly tampered: boolean;
}

export interface ExecutionRecord {
  readonly schemaVersion: typeof MODEL_SCHEMA_VERSION;
  readonly probeName: ProbeName;
  readonly runner: RunnerDescriptor;
  readonly startedAtEpochMs: number;
  readonly durationMs: number;
  readonly exitOutcome: ExitOutcome;
  readonly interceptorReport: InterceptorReport;
  /** CAS refs to raw (pre-normalization) observation payloads. */
  readonly rawObservationRefs: readonly ContentHash[];
}

export type ExecutionRecordInput = Omit<ExecutionRecord, 'schemaVersion'>;

export function createExecutionRecord(input: ExecutionRecordInput): ExecutionRecord {
  assertProbeName(input.probeName);
  if (!Number.isInteger(input.startedAtEpochMs) || input.startedAtEpochMs < 0) {
    throw new ValidationError('startedAtEpochMs must be a non-negative integer', 'KEEL_E_MODEL_INVALID_EXECUTION', {
      probeName: input.probeName,
    });
  }
  if (!Number.isFinite(input.durationMs) || input.durationMs < 0) {
    throw new ValidationError('durationMs must be non-negative', 'KEEL_E_MODEL_INVALID_EXECUTION', {
      probeName: input.probeName,
    });
  }
  return deepFreeze({ schemaVersion: MODEL_SCHEMA_VERSION, ...input });
}

/** Canonical content hash — deliberately excludes wall-clock fields (Doc 04). */
export function executionContentHash(record: ExecutionRecord): ContentHash {
  const { startedAtEpochMs: _startedAt, durationMs: _duration, ...canonicalContent } = record;
  return contentHashOf(canonicalContent);
}
