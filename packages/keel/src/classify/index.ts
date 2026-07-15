/**
 * classify/ — the Classification Engine (Ring 2, Doc 20 §6). Advisory intent
 * labels on divergences; never facts (L1), never check-failing (L2).
 * Phase 8 ships Tier 1 (deterministic heuristics) only; Tier 2 (local LLM)
 * is Phase 9. Importable only at composition roots (the AI-deletable seam).
 */

export { HeuristicClassifier } from './heuristic-classifier.js';
export type {
  ClassificationInput,
  DivergenceEvidence,
  ClassifierProbeMeta,
} from './heuristic-classifier.js';
export { BUILTIN_RULES, firstMatch } from './rules.js';
export type { HeuristicRule, RuleContext, RuleMatch } from './rules.js';
export { parseChangedFiles, addedDiffText, evidencePacketHash } from './evidence.js';
