/**
 * HeuristicClassifier — Tier 1 of the classification engine (Doc 07 §3,
 * Doc 20 §6). Deterministic: every divergence gets exactly one Annotation —
 * a rule match (`intended`/`collateral`, attributed by ruleId) or, when no
 * rule fires, `uncertain(no-rule-matched)` (tier 'none'). Never silent
 * (C55); never touches facts (L1); never throws a check-failing error
 * (Doc 20 §6 — advisory). Tier 2 (local LLM) is Phase 9. Stateless.
 *
 * Boundary note (Doc 21): `classify/` may NOT import `services/`. So this
 * class defines its OWN evidence-input types (it OWNS evidence packets per
 * Doc 20 §6) and implements the consumer-owned `IntentClassifierPort`
 * STRUCTURALLY — the composition roots verify assignability at build time.
 * That structural (not nominal) coupling is exactly what keeps the AI
 * layer deletable (C3): `services/` has zero compile dependency on us.
 */

import { createAnnotation } from '../model/index.js';
import type { Annotation, Divergence, ProbeName } from '../model/index.js';
import { addedDiffText, evidencePacketHash, parseChangedFiles } from './evidence.js';
import { BUILTIN_RULES, firstMatch } from './rules.js';
import type { HeuristicRule } from './rules.js';

/** Probe metadata a rule needs (mirrors services' ClassifierProbeMeta structurally). */
export interface ClassifierProbeMeta {
  readonly runner: string;
  readonly referencedPaths: readonly string[];
}

/** One divergence plus bounded value excerpts (classify owns the evidence packet, Doc 20 §6). */
export interface DivergenceEvidence {
  readonly divergence: Divergence;
  readonly baselineExcerpt: string | null;
  readonly candidateExcerpt: string | null;
}

/** The classification input — structurally identical to services' ClassificationRequest. */
export interface ClassificationInput {
  readonly evidence: readonly DivergenceEvidence[];
  readonly codeDiff: string;
  readonly probes: Readonly<Record<ProbeName, ClassifierProbeMeta>>;
  readonly suppressedStableIds: readonly string[];
  readonly signal: AbortSignal;
}

export class HeuristicClassifier {
  private readonly rules: readonly HeuristicRule[];

  constructor(rules: readonly HeuristicRule[] = BUILTIN_RULES) {
    this.rules = rules;
  }

  classify(request: ClassificationInput): Promise<readonly Annotation[]> {
    const changedFiles = parseChangedFiles(request.codeDiff);
    const added = addedDiffText(request.codeDiff);
    const suppressed = new Set(request.suppressedStableIds);
    const annotations = request.evidence.map((item) =>
      this.classifyOne(item, request, changedFiles, added, suppressed),
    );
    return Promise.resolve(annotations);
  }

  private classifyOne(
    item: DivergenceEvidence,
    request: ClassificationInput,
    changedFiles: ReadonlySet<string>,
    added: string,
    suppressed: ReadonlySet<string>,
  ): Annotation {
    const probeMeta = request.probes[item.divergence.probeName];
    const referencedPaths = probeMeta?.referencedPaths ?? [];
    const match = firstMatch(
      {
        divergence: item.divergence,
        baselineExcerpt: item.baselineExcerpt,
        candidateExcerpt: item.candidateExcerpt,
        changedFiles,
        hasCodeDiff: request.codeDiff.length > 0,
        addedDiffText: added,
        probeReferencedPaths: referencedPaths,
        suppressedStableIds: suppressed,
      },
      this.rules,
    );

    if (match === undefined) {
      return createAnnotation({
        divergenceStableId: item.divergence.stableId,
        label: 'uncertain',
        confidence: 0,
        attribution: { tier: 'none', reason: 'no-rule-matched' },
        rationale: 'no heuristic rule matched; awaiting Tier 2 (Phase 9)',
        evidencePacketHash: null,
      });
    }

    return createAnnotation({
      divergenceStableId: item.divergence.stableId,
      label: match.label,
      confidence: match.confidence,
      attribution: { tier: 'heuristic', ruleId: match.ruleId },
      rationale: match.rationale,
      evidencePacketHash: evidencePacketHash({
        divergence: item.divergence,
        baselineExcerpt: item.baselineExcerpt,
        candidateExcerpt: item.candidateExcerpt,
        codeDiff: request.codeDiff,
        probeReferencedPaths: referencedPaths,
        suppressed: suppressed.has(item.divergence.stableId),
      }),
    });
  }
}
