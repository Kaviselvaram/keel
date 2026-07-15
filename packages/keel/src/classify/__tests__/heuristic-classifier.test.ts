import { describe, expect, it } from 'vitest';
import { createDivergence } from '../../model/index.js';
import type { Divergence } from '../../model/index.js';
import { HeuristicClassifier } from '../heuristic-classifier.js';
import type { ClassificationInput, DivergenceEvidence } from '../heuristic-classifier.js';

const classifier = new HeuristicClassifier();
const CANDIDATE = 'b'.repeat(64);

function divergence(overrides: Partial<Parameters<typeof createDivergence>[0]> = {}): Divergence {
  return createDivergence({
    probeName: 'app',
    path: { observation: 'stream', locator: 'stdout/text' },
    kind: 'value-changed',
    baselineValueRef: 'a'.repeat(64),
    candidateValueRef: CANDIDATE,
    ...overrides,
  });
}

function input(evidence: readonly DivergenceEvidence[], overrides: Partial<ClassificationInput> = {}): ClassificationInput {
  return {
    evidence,
    codeDiff: '',
    probes: { app: { runner: 'command', referencedPaths: ['app.js'] } },
    suppressedStableIds: [],
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe('HeuristicClassifier', () => {
  it('produces exactly one annotation per divergence', async () => {
    const evidence = [
      { divergence: divergence(), baselineExcerpt: null, candidateExcerpt: null },
      { divergence: divergence({ kind: 'shape-changed' }), baselineExcerpt: null, candidateExcerpt: null },
    ];
    const annotations = await classifier.classify(input(evidence));
    expect(annotations).toHaveLength(2);
    expect(new Set(annotations.map((a) => a.divergenceStableId)).size).toBe(2);
  });

  it('labels an unmatched divergence uncertain(no-rule-matched), tier none, no evidence packet (C55)', async () => {
    const div = divergence();
    const [annotation] = await classifier.classify(
      input([{ divergence: div, baselineExcerpt: 'x', candidateExcerpt: 'y' }]),
    );
    expect(annotation?.label).toBe('uncertain');
    expect(annotation?.attribution).toEqual({ tier: 'none', reason: 'no-rule-matched' });
    expect(annotation?.evidencePacketHash).toBeNull();
    expect(annotation?.confidence).toBe(0);
  });

  it('attributes a heuristic match by ruleId with an evidence-packet hash (C50)', async () => {
    const div = divergence();
    const [annotation] = await classifier.classify(
      input([{ divergence: div, baselineExcerpt: 'v1', candidateExcerpt: 'bonjour' }], {
        codeDiff: "+++ b/greet.js\n+  return 'bonjour';",
      }),
    );
    expect(annotation?.label).toBe('intended');
    expect(annotation?.attribution).toEqual({ tier: 'heuristic', ruleId: 'edited-value-overlap' });
    expect(annotation?.evidencePacketHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic: identical input yields identical annotations (incl. evidence hashes)', async () => {
    const div = divergence();
    const build = () =>
      input([{ divergence: div, baselineExcerpt: 'v1', candidateExcerpt: 'bonjour' }], {
        codeDiff: "+++ b/greet.js\n+  return 'bonjour';",
      });
    const first = await classifier.classify(build());
    const second = await classifier.classify(build());
    expect(first).toEqual(second);
  });

  it('suppressed stableId → intended via the suppression rule', async () => {
    const div = divergence();
    const [annotation] = await classifier.classify(
      input([{ divergence: div, baselineExcerpt: null, candidateExcerpt: null }], {
        suppressedStableIds: [div.stableId],
      }),
    );
    expect(annotation?.attribution).toEqual({ tier: 'heuristic', ruleId: 'suppressed-stable-id' });
    expect(annotation?.label).toBe('intended');
  });

  it('untouched-file → collateral (the scariest regression)', async () => {
    const div = divergence();
    const [annotation] = await classifier.classify(
      input([{ divergence: div, baselineExcerpt: null, candidateExcerpt: null }], {
        codeDiff: '+++ b/other.js\n+  // unrelated change',
      }),
    );
    expect(annotation?.label).toBe('collateral');
    expect(annotation?.attribution).toEqual({ tier: 'heuristic', ruleId: 'untouched-file-collateral' });
  });
});
