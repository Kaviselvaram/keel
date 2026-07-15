import { describe, expect, it } from 'vitest';
import { createDivergence } from '../../model/index.js';
import type { Divergence } from '../../model/index.js';
import { BUILTIN_RULES, firstMatch } from '../rules.js';
import type { RuleContext } from '../rules.js';

const HASH = 'a'.repeat(64);

function divergence(overrides: Partial<Parameters<typeof createDivergence>[0]> = {}): Divergence {
  return createDivergence({
    probeName: 'app',
    path: { observation: 'stream', locator: 'stdout/text' },
    kind: 'value-changed',
    baselineValueRef: HASH,
    candidateValueRef: 'b'.repeat(64),
    ...overrides,
  });
}

function context(overrides: Partial<RuleContext> = {}): RuleContext {
  return {
    divergence: divergence(),
    baselineExcerpt: 'old',
    candidateExcerpt: 'new',
    changedFiles: new Set<string>(),
    hasCodeDiff: false,
    addedDiffText: '',
    probeReferencedPaths: ['app.js'],
    suppressedStableIds: new Set<string>(),
    ...overrides,
  };
}

describe('suppressed-stable-id rule', () => {
  const rule = BUILTIN_RULES.find((r) => r.id === 'suppressed-stable-id');
  it('fires intended when the stableId is actively suppressed', () => {
    const div = divergence();
    const match = rule?.evaluate(context({ divergence: div, suppressedStableIds: new Set([div.stableId]) }));
    expect(match).toMatchObject({ ruleId: 'suppressed-stable-id', label: 'intended' });
    expect(match?.confidence).toBeGreaterThanOrEqual(0.95);
  });
  it('does not fire otherwise', () => {
    expect(rule?.evaluate(context())).toBeUndefined();
  });
});

describe('edited-value-overlap rule', () => {
  const rule = BUILTIN_RULES.find((r) => r.id === 'edited-value-overlap');
  it('fires intended when a candidate token appears in an added diff line', () => {
    const match = rule?.evaluate(
      context({ candidateExcerpt: 'bonjour', addedDiffText: "  return 'bonjour';" }),
    );
    expect(match).toMatchObject({ ruleId: 'edited-value-overlap', label: 'intended' });
  });
  it('does not fire when the candidate value is absent from the diff', () => {
    expect(rule?.evaluate(context({ candidateExcerpt: 'bonjour', addedDiffText: '  const x = 1;' }))).toBeUndefined();
  });
  it('ignores trivially short tokens (no false match on punctuation)', () => {
    expect(rule?.evaluate(context({ candidateExcerpt: 'a b', addedDiffText: 'a b c' }))).toBeUndefined();
  });
  it('does not fire when there is no candidate excerpt', () => {
    expect(rule?.evaluate(context({ candidateExcerpt: null, addedDiffText: 'anything' }))).toBeUndefined();
  });
});

describe('untouched-file-collateral rule', () => {
  const rule = BUILTIN_RULES.find((r) => r.id === 'untouched-file-collateral');
  it('fires collateral when the diff edited only files the probe does not reference', () => {
    const match = rule?.evaluate(
      context({ hasCodeDiff: true, changedFiles: new Set(['other.js']), probeReferencedPaths: ['app.js'] }),
    );
    expect(match).toMatchObject({ ruleId: 'untouched-file-collateral', label: 'collateral' });
  });
  it('does not fire when the diff touched a file the probe references', () => {
    expect(
      rule?.evaluate(
        context({ hasCodeDiff: true, changedFiles: new Set(['app.js']), probeReferencedPaths: ['app.js'] }),
      ),
    ).toBeUndefined();
  });
  it('does not fire when there is no diff (cannot claim "untouched")', () => {
    expect(rule?.evaluate(context({ hasCodeDiff: false, changedFiles: new Set() }))).toBeUndefined();
  });
  it('matches by basename so path prefixes do not fool it', () => {
    expect(
      rule?.evaluate(
        context({ hasCodeDiff: true, changedFiles: new Set(['src/app.js']), probeReferencedPaths: ['./app.js'] }),
      ),
    ).toBeUndefined();
  });
});

describe('firstMatch precedence', () => {
  it('suppression outranks an untouched-file signal (both would fire)', () => {
    const div = divergence();
    const match = firstMatch(
      context({
        divergence: div,
        suppressedStableIds: new Set([div.stableId]),
        hasCodeDiff: true,
        changedFiles: new Set(['other.js']),
        probeReferencedPaths: ['app.js'],
      }),
    );
    expect(match?.ruleId).toBe('suppressed-stable-id');
  });
  it('returns undefined when nothing matches', () => {
    expect(firstMatch(context())).toBeUndefined();
  });
});
