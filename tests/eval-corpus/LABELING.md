# Eval Corpus — Labeling Process

The eval corpus ([cases.json](cases.json)) is the ground truth against which classifier quality is measured (Doc 07 §5). It is a **first-class repo artifact**: classifier changes are measured against it, not felt.

## What a case is

One labeled divergence: the divergence facts (probe, path, kind, value excerpts), the code-diff context, the probe's referenced paths, any active suppressions, and the **ground-truth intent** (`intended` / `collateral` / `uncertain`). `uncertain` marks a case where no deterministic signal should let a heuristic claim intent — the honest "a human (or Tier 2) must decide."

## The two-maintainer rule (C71)

**Every ground-truth label requires two-maintainer agreement.** A single maintainer may *propose* a case or a label change; a second maintainer must approve it in the PR before merge. This is enforced by review, and mirrors the Constitution's rule for corpus labels (C71) and Constitution amendments. Rationale: ground truth that one person can change unilaterally is not ground truth — it is that person's opinion, and it would let a classifier be "tuned to green" by editing the answer key.

## How it is measured

`packages/keel/src/classify/__tests__/eval-corpus.test.ts` runs the `HeuristicClassifier` over every case and reports, per tier:

- **Precision** on the *claimed* subset — of the annotations the classifier labeled `intended`/`collateral` (i.e. made a claim), the fraction whose label matches ground truth. **Gate: ≥ 0.95** (Doc 24 P8 acceptance).
- **Recall** — of the non-`uncertain` ground-truth cases, the fraction the classifier claimed. Reported, not gated (a conservative classifier that abstains is safe; a wrong one is not).

Precision is gated because a false `intended` on a real regression is the one mistake an oracle must not make. Recall grows safely as the rule library grows (Doc 07 §3).

## Adding a case

1. Add the labeled case with a distinct 64-hex `stableId`.
2. Open a PR; a second maintainer reviews the label.
3. CI runs the corpus test; precision must stay ≥ 0.95.
4. Every user-reported false positive/negative becomes a corpus case before its fix merges (C69).
