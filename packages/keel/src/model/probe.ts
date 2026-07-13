/**
 * ProbeSpec — the frozen copy of a declared probe embedded in baselines
 * (Doc 04: probes exist as config; a ProbeSpecSnapshot + hash survives
 * config edits). Owner: config/ constructs these from validated input;
 * model owns shape, invariants, and the spec hash.
 */

import { deepFreeze } from './freeze.js';
import { contentHashOf } from './hashing.js';
import type { ContentHash, ProbeName } from './identity.js';
import { assertProbeName } from './identity.js';
import { ValidationError } from './errors.js';
import { MODEL_SCHEMA_VERSION } from './versions.js';

export type StdinSource =
  | { readonly kind: 'none' }
  | { readonly kind: 'inline'; readonly contentHash: ContentHash }
  | { readonly kind: 'file'; readonly path: string };

export interface ProbeInvocation {
  readonly command: string;
  readonly args: readonly string[];
  /** Repo-relative, POSIX-separated. */
  readonly cwd: string;
  readonly stdin: StdinSource;
  readonly envAllowlist: readonly string[];
}

/** Interception policies (Doc 04): network 'forbidden' is the passthrough-forbidden policy. */
export interface InterceptionPolicy {
  readonly clock: 'virtual' | 'none';
  readonly rng: 'seeded' | 'none';
  readonly network: 'record' | 'stub' | 'forbidden';
}

export interface ProbeLimits {
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly maxFsEffectBytes: number;
}

/** Fixture lifecycle hooks (ADR amendment in Doc 04): commands are part of the spec and therefore of its hash. */
export interface ProbeHooks {
  readonly setup?: string;
  readonly teardown?: string;
}

export interface ProbeSpec {
  readonly schemaVersion: typeof MODEL_SCHEMA_VERSION;
  readonly name: ProbeName;
  /** Runner id: 'command', 'node', or a plugin id. Registry membership is execution's concern. */
  readonly runner: string;
  readonly captureMode: 'process';
  readonly invocation: ProbeInvocation;
  readonly interception: InterceptionPolicy;
  readonly limits: ProbeLimits;
  readonly hooks: ProbeHooks;
  /** Opaque matcher patterns; the rule language is owned by capture/diff (Doc 03 §3.2). */
  readonly ignoreRules: readonly string[];
  /** Doc 12: opt out of parallel execution. */
  readonly serial: boolean;
}

export type ProbeSpecInput = Omit<ProbeSpec, 'schemaVersion'>;

function requirePositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new ValidationError(`${field} must be a positive integer`, 'KEEL_E_MODEL_INVALID_PROBE', {
      field,
      value,
    });
  }
}

export function createProbeSpec(input: ProbeSpecInput): ProbeSpec {
  assertProbeName(input.name);
  if (input.runner.length === 0) {
    throw new ValidationError('runner id must be non-empty', 'KEEL_E_MODEL_INVALID_PROBE', { name: input.name });
  }
  if (input.invocation.command.length === 0) {
    throw new ValidationError('invocation command must be non-empty', 'KEEL_E_MODEL_INVALID_PROBE', { name: input.name });
  }
  requirePositiveInteger(input.limits.timeoutMs, 'limits.timeoutMs');
  requirePositiveInteger(input.limits.maxOutputBytes, 'limits.maxOutputBytes');
  requirePositiveInteger(input.limits.maxFsEffectBytes, 'limits.maxFsEffectBytes');
  const duplicateEnv = input.invocation.envAllowlist.find(
    (name, index) => input.invocation.envAllowlist.indexOf(name) !== index,
  );
  if (duplicateEnv !== undefined) {
    throw new ValidationError(`duplicate env allowlist entry '${duplicateEnv}'`, 'KEEL_E_MODEL_INVALID_PROBE', {
      name: input.name,
    });
  }
  return deepFreeze({ schemaVersion: MODEL_SCHEMA_VERSION, ...input });
}

/**
 * The probe spec hash embedded in snapshots and baselines (Doc 04). Covers
 * the whole spec — including hooks (a changed fixture honestly invalidates
 * the baseline) — via canonical serialization, so field order can never
 * matter.
 */
export function probeSpecHash(spec: ProbeSpec): ContentHash {
  return contentHashOf(spec);
}
