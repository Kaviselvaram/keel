/**
 * Baseline — an immutable, labeled set of snapshots bound to provenance
 * (Doc 04). Lifecycle: capturing → sealed | rejected(nondeterministic).
 * A sealed baseline never changes (C40); transitions return new frozen
 * values and refuse anything else.
 */

import { deepFreeze } from './freeze.js';
import { ValidationError } from './errors.js';
import type { ContentHash, EntityId, ProbeName } from './identity.js';
import {
  assertContentHash as assertHashFormat,
  assertEntityId,
  assertProbeName,
} from './identity.js';
import { MODEL_SCHEMA_VERSION } from './versions.js';

/** Doc 06 A4 (per-field policy is applied by replay; the model records the facts, including ICU per the freeze amendment). */
export interface EnvironmentFingerprint {
  readonly os: string;
  readonly arch: string;
  readonly runtimeName: string;
  readonly runtimeVersion: string;
  readonly icuVersion: string;
  /** Interceptor versions participate per Doc 05 (a clock-shim fix honestly invalidates baselines). */
  readonly interceptorVersions: Readonly<Record<string, string>>;
}

export interface Provenance {
  readonly gitCommit: string | null;
  readonly gitDirty: boolean;
  readonly configHash: ContentHash;
  readonly environment: EnvironmentFingerprint;
  readonly keelVersion: string;
  readonly normalizationRulesetVersion: string;
}

export type BaselineStatus = 'capturing' | 'sealed' | 'rejected';

/** Why capture verification refused to seal (Doc 06 A1: names the flapping path). */
export interface BaselineRejection {
  readonly probeName: ProbeName;
  readonly flappingPath: string;
  readonly reason: string;
}

export interface Baseline {
  readonly schemaVersion: typeof MODEL_SCHEMA_VERSION;
  readonly id: EntityId;
  readonly label: string;
  readonly status: BaselineStatus;
  /** probeName → snapshot contentHash (snapshots themselves live in the CAS). */
  readonly snapshots: Readonly<Record<ProbeName, ContentHash>>;
  readonly provenance: Provenance;
  readonly sealedAtEpochMs: number | null;
  readonly rejection: BaselineRejection | null;
}

export interface CapturingBaselineInput {
  readonly id: EntityId;
  readonly label: string;
  readonly provenance: Provenance;
}

export function createCapturingBaseline(input: CapturingBaselineInput): Baseline {
  assertEntityId(input.id, 'baseline.id');
  if (input.label.length === 0) {
    throw new ValidationError('baseline label must be non-empty', 'KEEL_E_MODEL_INVALID_BASELINE', {
      id: input.id,
    });
  }
  assertHashFormat(input.provenance.configHash, 'provenance.configHash');
  return deepFreeze({
    schemaVersion: MODEL_SCHEMA_VERSION,
    id: input.id,
    label: input.label,
    status: 'capturing' as const,
    snapshots: {},
    provenance: input.provenance,
    sealedAtEpochMs: null,
    rejection: null,
  });
}

function requireStatus(baseline: Baseline, expected: BaselineStatus, transition: string): void {
  if (baseline.status !== expected) {
    throw new ValidationError(
      `cannot ${transition} a ${baseline.status} baseline`,
      'KEEL_E_MODEL_INVALID_TRANSITION',
      { id: baseline.id, from: baseline.status, transition },
    );
  }
}

/** Adds a snapshot reference during capture. Duplicate probe names are broken ownership. */
export function withSnapshotRef(
  baseline: Baseline,
  probeName: ProbeName,
  snapshotHash: ContentHash,
): Baseline {
  requireStatus(baseline, 'capturing', 'add a snapshot to');
  assertProbeName(probeName);
  assertHashFormat(snapshotHash, 'snapshotHash');
  if (probeName in baseline.snapshots) {
    throw new ValidationError(
      `duplicate snapshot for probe '${probeName}'`,
      'KEEL_E_MODEL_DUPLICATE_PROBE',
      { id: baseline.id, probeName },
    );
  }
  return deepFreeze({
    ...baseline,
    snapshots: { ...baseline.snapshots, [probeName]: snapshotHash },
  });
}

/** capturing → sealed. Requires at least one snapshot; sets sealedAt (the only status timestamps the model records). */
export function sealBaseline(baseline: Baseline, sealedAtEpochMs: number): Baseline {
  requireStatus(baseline, 'capturing', 'seal');
  if (Object.keys(baseline.snapshots).length === 0) {
    throw new ValidationError('cannot seal a baseline with no snapshots', 'KEEL_E_MODEL_INVALID_BASELINE', {
      id: baseline.id,
    });
  }
  if (!Number.isInteger(sealedAtEpochMs) || sealedAtEpochMs < 0) {
    throw new ValidationError('sealedAtEpochMs must be a non-negative integer', 'KEEL_E_MODEL_INVALID_BASELINE', {
      id: baseline.id,
    });
  }
  return deepFreeze({ ...baseline, status: 'sealed' as const, sealedAtEpochMs });
}

/** capturing → rejected(nondeterministic), naming the flapping observation path (Doc 06 A1). */
export function rejectBaseline(baseline: Baseline, rejection: BaselineRejection): Baseline {
  requireStatus(baseline, 'capturing', 'reject');
  assertProbeName(rejection.probeName, 'rejection.probeName');
  if (rejection.flappingPath.length === 0 || rejection.reason.length === 0) {
    throw new ValidationError(
      'rejection must name the flapping path and a reason',
      'KEEL_E_MODEL_INVALID_BASELINE',
      { id: baseline.id },
    );
  }
  return deepFreeze({ ...baseline, status: 'rejected' as const, rejection });
}
