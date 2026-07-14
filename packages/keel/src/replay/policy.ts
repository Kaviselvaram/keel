/**
 * Per-field provenance compatibility policy (ADR-012, Doc 06 A4).
 *
 * Frozen defaults: config hash, normalization ruleset, runtime major,
 * OS, arch, and interceptor versions are `strict` (refuse → stale-baseline);
 * runtime minor/patch and ICU are `warn` (proceed, flagged); git commit is
 * `warn` — checking an edited tree against a baseline from an older commit
 * is the primary use case (ADR-012 "ancestor-drift"), refusing would be
 * staleness fatigue. `ignore` produces no finding at all.
 */

import type { EnvironmentFingerprint, Provenance, StalenessFinding } from '../model/index.js';

export type PolicyLevel = 'strict' | 'warn' | 'ignore';

export type ProvenanceField =
  | 'configHash'
  | 'normalizationRulesetVersion'
  | 'runtimeMajor'
  | 'runtimeMinor'
  | 'os'
  | 'arch'
  | 'icuVersion'
  | 'interceptorVersions'
  | 'gitCommit';

export type ReplayPolicy = Readonly<Record<ProvenanceField, PolicyLevel>>;

export const DEFAULT_REPLAY_POLICY: ReplayPolicy = {
  configHash: 'strict',
  normalizationRulesetVersion: 'strict',
  runtimeMajor: 'strict',
  os: 'strict',
  arch: 'strict',
  interceptorVersions: 'strict',
  runtimeMinor: 'warn',
  icuVersion: 'warn',
  gitCommit: 'warn',
};

export interface CurrentConditions {
  readonly configHash: string;
  readonly normalizationRulesetVersion: string;
  readonly environment: EnvironmentFingerprint;
  readonly gitCommit: string | null;
}

export interface ProvenanceEvaluation {
  /** Every strict and warn finding (ignore-level fields never appear). */
  readonly findings: readonly StalenessFinding[];
  /** True when any strict field mismatched — the baseline is stale. */
  readonly fatal: boolean;
}

const major = (version: string): string => version.split('.')[0] ?? version;

const canonicalVersions = (versions: Readonly<Record<string, string>>): string =>
  Object.entries(versions)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, value]) => `${key}=${value}`)
    .join(',');

export function evaluateProvenance(
  baseline: Provenance,
  current: CurrentConditions,
  policy: ReplayPolicy = DEFAULT_REPLAY_POLICY,
): ProvenanceEvaluation {
  const findings: StalenessFinding[] = [];

  const check = (field: ProvenanceField, expected: string, actual: string): void => {
    const level = policy[field];
    if (level === 'ignore' || expected === actual) return;
    findings.push({ field, expected, actual, policy: level });
  };

  const base = baseline.environment;
  const now = current.environment;

  check('configHash', baseline.configHash, current.configHash);
  check(
    'normalizationRulesetVersion',
    baseline.normalizationRulesetVersion,
    current.normalizationRulesetVersion,
  );
  check(
    'runtimeMajor',
    `${base.runtimeName}/${major(base.runtimeVersion)}`,
    `${now.runtimeName}/${major(now.runtimeVersion)}`,
  );
  if (major(base.runtimeVersion) === major(now.runtimeVersion)) {
    check('runtimeMinor', base.runtimeVersion, now.runtimeVersion);
  }
  check('os', base.os, now.os);
  check('arch', base.arch, now.arch);
  check('icuVersion', base.icuVersion, now.icuVersion);
  check(
    'interceptorVersions',
    canonicalVersions(base.interceptorVersions),
    canonicalVersions(now.interceptorVersions),
  );
  check('gitCommit', baseline.gitCommit ?? '(none)', current.gitCommit ?? '(none)');

  return {
    findings,
    fatal: findings.some((finding) => finding.policy === 'strict'),
  };
}
