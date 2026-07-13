/**
 * Annotation — advisory classification of one divergence (Doc 04).
 * Never a fact: annotations are additive metadata on a verdict (L1/L2),
 * always attributed to their producer (C50), confidence in honest bands.
 */

import { deepFreeze } from './freeze.js';
import { ValidationError } from './errors.js';
import type { ContentHash } from './identity.js';
import { assertContentHash as assertHashFormat } from './identity.js';
import { MODEL_SCHEMA_VERSION } from './versions.js';

export type IntentLabel = 'intended' | 'collateral' | 'uncertain';

/** Why the classifier could not decide (Doc 07 fallback ladder — visible, never silent, C55). */
export type UncertainReason =
  | 'inference-unavailable'
  | 'budget-exhausted'
  | 'malformed-output'
  | 'no-rule-matched'
  | 'inference-error';

/** Attribution (C50): every judgment names its producer exactly. */
export type ClassifierAttribution =
  | { readonly tier: 'heuristic'; readonly ruleId: string }
  | { readonly tier: 'llm'; readonly model: string; readonly templateVersion: string }
  | { readonly tier: 'none'; readonly reason: UncertainReason };

export interface Annotation {
  readonly schemaVersion: typeof MODEL_SCHEMA_VERSION;
  readonly divergenceStableId: ContentHash;
  readonly label: IntentLabel;
  /** 0..1; coarse bands are policy (Doc 07) — the model only enforces the range. */
  readonly confidence: number;
  readonly attribution: ClassifierAttribution;
  readonly rationale: string;
  /** Hash of the evidence packet the judgment was made from (reproducibility). Null for tier 'none'. */
  readonly evidencePacketHash: ContentHash | null;
}

export type AnnotationInput = Omit<Annotation, 'schemaVersion'>;

export function createAnnotation(input: AnnotationInput): Annotation {
  assertHashFormat(input.divergenceStableId, 'divergenceStableId');
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
    throw new ValidationError('confidence must be in [0, 1]', 'KEEL_E_MODEL_INVALID_ANNOTATION', {
      confidence: input.confidence,
    });
  }
  if (input.attribution.tier === 'none') {
    if (input.label !== 'uncertain') {
      throw new ValidationError(
        "attribution tier 'none' requires label 'uncertain'",
        'KEEL_E_MODEL_INVALID_ANNOTATION',
        { label: input.label },
      );
    }
    if (input.evidencePacketHash !== null) {
      throw new ValidationError(
        "attribution tier 'none' cannot carry an evidence packet",
        'KEEL_E_MODEL_INVALID_ANNOTATION',
        {},
      );
    }
  } else if (input.evidencePacketHash !== null) {
    assertHashFormat(input.evidencePacketHash, 'evidencePacketHash');
  }
  return deepFreeze({ schemaVersion: MODEL_SCHEMA_VERSION, ...input });
}
