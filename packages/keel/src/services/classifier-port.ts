/**
 * Consumer-owned classifier port (C22, Doc 20 §6/§11).
 *
 * CheckService orchestrates classification through THIS interface — never a
 * direct import of `classify/`. That is what makes the AI-deletable build
 * work (C3/L2): deleting `classify/` removes only the composition-root
 * wiring, not the deterministic core. `classify/`'s `HeuristicClassifier`
 * satisfies this shape structurally.
 */

import type { Annotation, Divergence, ProbeName } from '../model/index.js';

/** Minimal probe metadata a heuristic needs (Doc 07 §2 evidence: probe metadata). */
export interface ClassifierProbeMeta {
  readonly runner: string;
  /** Path-like tokens the probe's invocation references (command + args) — the untouched-file signal. */
  readonly referencedPaths: readonly string[];
}

/** One divergence plus the bounded value excerpts the classifier may reason over. */
export interface DivergenceEvidence {
  readonly divergence: Divergence;
  /** Bounded baseline value text when retrievable (whole-stream refs); null for identity-only leaf refs. */
  readonly baselineExcerpt: string | null;
  readonly candidateExcerpt: string | null;
}

/** The full evidence bundle for one check run's classification (Doc 07 §2). */
export interface ClassificationRequest {
  readonly evidence: readonly DivergenceEvidence[];
  /** Unified git diff (baseline commit → working tree), bounded; '' when unavailable. */
  readonly codeDiff: string;
  readonly probes: Readonly<Record<ProbeName, ClassifierProbeMeta>>;
  /** stableIds with an active suppression — the suppressed-stableId rule's input. */
  readonly suppressedStableIds: readonly string[];
  readonly signal: AbortSignal;
}

/**
 * Advisory intent classification. Returns append-only Annotations; never
 * throws across this boundary in a way that fails a check (Doc 20 §6 failure
 * boundary — total failure degrades to `uncertain`).
 */
export interface IntentClassifierPort {
  classify(request: ClassificationRequest): Promise<readonly Annotation[]>;
}

/** Injected code-diff source (composition-root concern, C23; spawns git). */
export type CodeDiffSource = (baselineCommit: string | null) => Promise<string>;
