/**
 * Eval corpus v0 gate (Doc 07 §5, Doc 24 P8 acceptance): heuristic precision
 * on the CLAIMED subset must be >= 0.95. Recall is reported, not gated.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createDivergence } from '../../model/index.js';
import type { DivergenceKind, ObservationKind } from '../../model/index.js';
import { HeuristicClassifier } from '../heuristic-classifier.js';
import type { DivergenceEvidence } from '../heuristic-classifier.js';

interface CorpusCase {
  readonly name: string;
  readonly probeName: string;
  readonly stableId: string;
  readonly kind: DivergenceKind;
  readonly observation: ObservationKind;
  readonly locator: string;
  readonly baselineExcerpt: string | null;
  readonly candidateExcerpt: string | null;
  readonly codeDiff: string;
  readonly referencedPaths: readonly string[];
  readonly suppressedStableIds: readonly string[];
  readonly groundTruth: 'intended' | 'collateral' | 'uncertain';
}

const corpus = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../../../tests/eval-corpus/cases.json', import.meta.url)), 'utf8'),
) as { cases: readonly CorpusCase[] };

// Present-side refs so ref-presence validation passes for added/removed kinds.
function refsFor(kind: DivergenceKind): { baselineValueRef: string | null; candidateValueRef: string | null } {
  const A = 'a'.repeat(64);
  const B = 'b'.repeat(64);
  if (kind === 'entry-added' || kind === 'effect-added' || kind === 'unrecorded-effect') {
    return { baselineValueRef: null, candidateValueRef: B };
  }
  if (kind === 'entry-removed' || kind === 'effect-removed') {
    return { baselineValueRef: A, candidateValueRef: null };
  }
  return { baselineValueRef: A, candidateValueRef: B };
}

describe('eval corpus v0', () => {
  it('has enough labeled cases and a documented labeling process', () => {
    expect(corpus.cases.length).toBeGreaterThanOrEqual(10);
  });

  it('heuristic precision on the claimed subset is >= 0.95 (Doc 24 P8)', async () => {
    const classifier = new HeuristicClassifier();
    let claimed = 0;
    let correct = 0;
    let groundTruthClaimable = 0;
    let recalled = 0;
    const mislabels: string[] = [];

    for (const corpusCase of corpus.cases) {
      const refs = refsFor(corpusCase.kind);
      const divergence = createDivergence({
        probeName: corpusCase.probeName,
        path: { observation: corpusCase.observation, locator: corpusCase.locator },
        kind: corpusCase.kind,
        baselineValueRef: refs.baselineValueRef,
        candidateValueRef: refs.candidateValueRef,
      });
      // The corpus keys evidence/suppressions by its own stableId; remap to the
      // model-derived stableId so the suppression rule matches.
      const suppressed = corpusCase.suppressedStableIds.includes(corpusCase.stableId)
        ? [divergence.stableId]
        : [];
      const evidence: DivergenceEvidence = {
        divergence,
        baselineExcerpt: corpusCase.baselineExcerpt,
        candidateExcerpt: corpusCase.candidateExcerpt,
      };
      const [annotation] = await classifier.classify({
        evidence: [evidence],
        codeDiff: corpusCase.codeDiff,
        probes: { [corpusCase.probeName]: { runner: 'command', referencedPaths: corpusCase.referencedPaths } },
        suppressedStableIds: suppressed,
        signal: new AbortController().signal,
      });

      if (corpusCase.groundTruth !== 'uncertain') groundTruthClaimable += 1;
      if (annotation !== undefined && annotation.label !== 'uncertain') {
        claimed += 1;
        if (annotation.label === corpusCase.groundTruth) {
          correct += 1;
          recalled += 1;
        } else {
          mislabels.push(`${corpusCase.name}: said ${annotation.label}, truth ${corpusCase.groundTruth}`);
        }
      }
    }

    const precision = claimed === 0 ? 1 : correct / claimed;
    const recall = groundTruthClaimable === 0 ? 1 : recalled / groundTruthClaimable;
    // Reported for visibility (Doc 07 §5) — recall is not gated.
    console.info(
      `[eval-corpus] precision=${precision.toFixed(3)} (${String(correct)}/${String(claimed)}) recall=${recall.toFixed(3)}`,
    );
    expect(mislabels, mislabels.join('; ')).toEqual([]);
    expect(precision).toBeGreaterThanOrEqual(0.95);
    expect(claimed).toBeGreaterThan(0);
  });
});
