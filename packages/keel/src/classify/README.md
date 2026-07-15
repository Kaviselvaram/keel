# `classify/` — Classification Engine (Ring 2)

Contract: [Doc 20 §6](../../../../docs/architecture/20-module-contracts.md) · Design: [Doc 07](../../../../docs/architecture/07-classification.md) · Playbook: [Doc 24 P8](../../../../docs/architecture/24-implementation-playbooks.md)

**Advisory only.** Produces `Annotation`s that *explain* what the deterministic oracle already found — never facts (L1), never a check-failing error (L2, Doc 20 §6 failure boundary). Phase 8 ships **Tier 1** (deterministic heuristics); **Tier 2** (local LLM) is Phase 9.

**Imports:** model, config types, observability — and (Phase 9) the inference *port*. **Never** storage, execution, capture, replay, diff, adapters, or **services** (Doc 21). Because `classify/` may not import `services/`, and `services/` must compile with `classify/` deleted (C3/L2), the port is **consumer-owned in `services/` and implemented here structurally** — `HeuristicClassifier` matches `IntentClassifierPort` by shape, verified at the composition roots. This structural (not nominal) coupling is what keeps the whole AI layer deletable; the `ai-deletable` CI job proves it by `rm -rf classify inference` and rebuilding the deterministic core.

## Tier 1 rules (ordered; first match wins)

| ruleId | fires | label | confidence |
|--------|-------|-------|-----------|
| `suppressed-stable-id` | the divergence's stableId has an active suppression | `intended` | 0.98 |
| `edited-value-overlap` | a candidate-value token appears in the diff's added lines | `intended` | 0.90 |
| `untouched-file-collateral` | the diff edited files, none referenced by this probe | `collateral` | 0.85 |

No rule → `uncertain(no-rule-matched)`, tier `none`, no evidence packet (C55 — visible, never silent). Every heuristic annotation records its `ruleId` (C50) and a content-addressed **evidence-packet hash** for reproducibility. Confidences are calibrated against the [eval corpus](../../../../tests/eval-corpus/) — the corpus test gates heuristic precision ≥ 0.95 on the claimed subset. Rules are a data registry (`BUILTIN_RULES`); adding one is the extension point (Doc 20 §6), each individually tested.

## Where classification runs

`CheckService` invokes the classifier **strictly after** the verdict facts are persisted (C11): facts first, then advisory annotations via the one-shot `attachAnnotations` (append-only; a crash between the two loses advice, never truth). Total classifier failure degrades to zero annotations — the check still returns its facts.
