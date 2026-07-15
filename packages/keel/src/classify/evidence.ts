/**
 * Evidence-packet assembly (Doc 20 §6 ownership; Doc 07 §2). Turns the raw
 * classification request into per-divergence rule contexts, and produces the
 * content-addressed evidence-packet hash recorded on each annotation for
 * reproducibility. Pure and deterministic.
 */

import { contentHashOf } from '../model/index.js';
import type { ContentHash, Divergence } from '../model/index.js';

/** Parse the repo-relative paths a unified diff changed (from `+++ b/<path>` headers). */
export function parseChangedFiles(codeDiff: string): Set<string> {
  const files = new Set<string>();
  for (const line of codeDiff.split('\n')) {
    if (line.startsWith('+++ ')) {
      const target = line.slice(4).trim();
      if (target === '/dev/null') continue;
      files.add(target.replace(/^b\//, ''));
    }
  }
  return files;
}

/** Lowercased text of the diff's added lines (`+` but not the `+++` header). */
export function addedDiffText(codeDiff: string): string {
  return codeDiff
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1))
    .join('\n')
    .toLowerCase();
}

/**
 * The reproducibility hash for one divergence's classification: the exact
 * evidence the rule saw. Bounded excerpts and diff keep it stable and small.
 */
export function evidencePacketHash(input: {
  readonly divergence: Divergence;
  readonly baselineExcerpt: string | null;
  readonly candidateExcerpt: string | null;
  readonly codeDiff: string;
  readonly probeReferencedPaths: readonly string[];
  readonly suppressed: boolean;
}): ContentHash {
  return contentHashOf({
    stableId: input.divergence.stableId,
    kind: input.divergence.kind,
    path: `${input.divergence.path.observation}:${input.divergence.path.locator}`,
    baselineExcerpt: input.baselineExcerpt,
    candidateExcerpt: input.candidateExcerpt,
    codeDiff: input.codeDiff,
    probeReferencedPaths: [...input.probeReferencedPaths],
    suppressed: input.suppressed,
  });
}
