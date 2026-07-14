import { describe, expect, it } from 'vitest';
import type { Provenance } from '../../model/index.js';
import { DEFAULT_REPLAY_POLICY, evaluateProvenance } from '../policy.js';
import type { CurrentConditions } from '../policy.js';

const baseline: Provenance = {
  gitCommit: 'aaaa111',
  gitDirty: false,
  configHash: 'c'.repeat(64),
  environment: {
    os: 'linux',
    arch: 'x64',
    runtimeName: 'node',
    runtimeVersion: '22.4.0',
    icuVersion: '76.1',
    interceptorVersions: { clock: 'clock/1' },
  },
  keelVersion: '0.0.1',
  normalizationRulesetVersion: 'rules/1',
};

const matching: CurrentConditions = {
  configHash: baseline.configHash,
  normalizationRulesetVersion: 'rules/1',
  environment: baseline.environment,
  gitCommit: 'aaaa111',
};

describe('provenance policy (ADR-012 / Doc 06 A4)', () => {
  it('a matching environment yields zero findings', () => {
    expect(evaluateProvenance(baseline, matching)).toEqual({ findings: [], fatal: false });
  });

  it('strict fields are fatal: configHash, ruleset, runtime major, os, arch, interceptors', () => {
    const cases: Partial<CurrentConditions>[] = [
      { configHash: 'd'.repeat(64) },
      { normalizationRulesetVersion: 'rules/2' },
      { environment: { ...baseline.environment, runtimeVersion: '24.0.0' } },
      { environment: { ...baseline.environment, os: 'darwin' } },
      { environment: { ...baseline.environment, arch: 'arm64' } },
      { environment: { ...baseline.environment, interceptorVersions: { clock: 'clock/2' } } },
    ];
    for (const overrides of cases) {
      const evaluation = evaluateProvenance(baseline, { ...matching, ...overrides });
      expect(evaluation.fatal).toBe(true);
      expect(evaluation.findings.some((finding) => finding.policy === 'strict')).toBe(true);
    }
  });

  it('warn fields proceed: runtime minor, icu, git commit (ancestor-drift)', () => {
    const evaluation = evaluateProvenance(baseline, {
      ...matching,
      environment: { ...baseline.environment, runtimeVersion: '22.9.1', icuVersion: '77.0' },
      gitCommit: 'bbbb222',
    });
    expect(evaluation.fatal).toBe(false);
    expect(evaluation.findings.map((finding) => finding.field).sort()).toEqual([
      'gitCommit',
      'icuVersion',
      'runtimeMinor',
    ]);
    expect(evaluation.findings.every((finding) => finding.policy === 'warn')).toBe(true);
  });

  it('policy overrides work and ignore suppresses findings entirely', () => {
    const evaluation = evaluateProvenance(
      baseline,
      { ...matching, gitCommit: 'bbbb222' },
      { ...DEFAULT_REPLAY_POLICY, gitCommit: 'ignore' },
    );
    expect(evaluation.findings).toEqual([]);
    const strictGit = evaluateProvenance(
      baseline,
      { ...matching, gitCommit: 'bbbb222' },
      { ...DEFAULT_REPLAY_POLICY, gitCommit: 'strict' },
    );
    expect(strictGit.fatal).toBe(true);
  });

  it('runtime minor is only evaluated when the major matches (no double-reporting)', () => {
    const evaluation = evaluateProvenance(baseline, {
      ...matching,
      environment: { ...baseline.environment, runtimeVersion: '24.1.0' },
    });
    expect(evaluation.findings.map((finding) => finding.field)).toEqual(['runtimeMajor']);
  });
});
