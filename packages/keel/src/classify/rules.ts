/**
 * Heuristic rule registry — Tier 1 (Doc 07 §3). Deterministic: a predicate
 * over the evidence packet → label + fixed confidence + ruleId. Rules are
 * data (an ordered list); first match wins. Confidences are calibrated
 * against the eval corpus (Doc 07 §5), not chosen by feel — the corpus test
 * enforces ≥95% precision on the subset the rules claim.
 *
 * Extension point (Doc 20 §6): add a rule to BUILTIN_RULES; it is
 * individually tested and its ruleId is recorded on every annotation it
 * produces (C50 attribution).
 */

import type { Divergence } from '../model/index.js';

/** The per-divergence context a rule reasons over (assembled by evidence.ts). */
export interface RuleContext {
  readonly divergence: Divergence;
  readonly baselineExcerpt: string | null;
  readonly candidateExcerpt: string | null;
  /** Repo-relative paths the code diff changed (parsed from the unified diff). */
  readonly changedFiles: ReadonlySet<string>;
  /** Whether a code diff was available at all (distinguishes "no change" from "unknown"). */
  readonly hasCodeDiff: boolean;
  /** Added-line text of the code diff, lowercased, for literal-overlap checks. */
  readonly addedDiffText: string;
  /** Path tokens the diverging probe references. */
  readonly probeReferencedPaths: readonly string[];
  readonly suppressedStableIds: ReadonlySet<string>;
}

export interface RuleMatch {
  readonly ruleId: string;
  readonly label: 'intended' | 'collateral';
  readonly confidence: number;
  readonly rationale: string;
}

export interface HeuristicRule {
  readonly id: string;
  evaluate(context: RuleContext): RuleMatch | undefined;
}

const basename = (token: string): string => token.split(/[\\/]/).pop() ?? token;

/** The candidate value's non-trivial tokens appear as added diff content. */
function candidateAppearsInDiff(context: RuleContext): boolean {
  const excerpt = context.candidateExcerpt;
  if (excerpt === null || context.addedDiffText.length === 0) return false;
  const tokens = excerpt
    .split(/[^A-Za-z0-9_.-]+/)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length >= 3);
  if (tokens.length === 0) return false;
  return tokens.some((token) => context.addedDiffText.includes(token));
}

/**
 * Ordered registry (Doc 07 §3). Order is precedence: an explicit human
 * decision (suppression) outranks an inferred one; a literal code edit
 * outranks a structural inference.
 */
export const BUILTIN_RULES: readonly HeuristicRule[] = [
  {
    // The developer already accepted this exact divergence.
    id: 'suppressed-stable-id',
    evaluate(context) {
      if (!context.suppressedStableIds.has(context.divergence.stableId)) return undefined;
      return {
        ruleId: 'suppressed-stable-id',
        label: 'intended',
        confidence: 0.98,
        rationale: 'an active suppression already accepts this exact divergence',
      };
    },
  },
  {
    // The code diff literally introduced the new value.
    id: 'edited-value-overlap',
    evaluate(context) {
      if (!candidateAppearsInDiff(context)) return undefined;
      return {
        ruleId: 'edited-value-overlap',
        label: 'intended',
        confidence: 0.9,
        rationale: "the changed value appears in the code diff's added lines",
      };
    },
  },
  {
    // The probe's own entry points were not edited, yet behavior changed —
    // the scariest kind of regression (Doc 07 §3). Fires only when we have a
    // diff to reason about and it touched files disjoint from the probe.
    id: 'untouched-file-collateral',
    evaluate(context) {
      if (!context.hasCodeDiff || context.changedFiles.size === 0) return undefined;
      const changedBasenames = new Set([...context.changedFiles].map(basename));
      const probeTouchesChanged = context.probeReferencedPaths
        .map(basename)
        .some((name) => changedBasenames.has(name));
      if (probeTouchesChanged) return undefined;
      return {
        ruleId: 'untouched-file-collateral',
        label: 'collateral',
        confidence: 0.85,
        rationale: "behavior changed but the diff edited no file this probe references",
      };
    },
  },
];

/** First matching rule wins (deterministic, order-defined). */
export function firstMatch(
  context: RuleContext,
  rules: readonly HeuristicRule[] = BUILTIN_RULES,
): RuleMatch | undefined {
  for (const rule of rules) {
    const match = rule.evaluate(context);
    if (match !== undefined) return match;
  }
  return undefined;
}
