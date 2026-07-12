# KEEL — AI Classification Engine

> Document 07 · Status: FROZEN — Architecture v1.0 (2026-07-12) · (Design only; no prompts.)

## 1. Position in the Architecture — why AI is outside the deterministic core

The classifier answers a question the runtime *cannot*: "was this change what the developer meant?" Intent is not observable; it must be inferred from evidence (the code diff, the divergence, probe metadata). Inference is fallible, so it is architecturally quarantined:

- Runs strictly **after** the Verdict's facts are persisted (Doc 02 §3 step 6–7).
- Its module cannot be imported by Rings 0–1 (CI-enforced).
- Its total failure degrades labels to `uncertain`, never alters facts, never blocks a verdict.
- Deleting `classify/` + `inference/` must leave every deterministic test green (L2, verified by a CI job that literally builds without them).

## 2. Responsibilities, Inputs, Outputs

**Responsibility:** produce an Annotation (`intended` / `collateral` / `uncertain`, confidence, rationale, tier) per Divergence, within a budget.

**Inputs (the "evidence packet," content-hashed for reproducibility):** the divergence (kind, path, bounded value excerpts), the code diff hunks (git diff between baseline commit and working tree — *bounded and ranked by path-relevance to the probe*), probe metadata, prior annotations/suppressions for the same `stableId`.

**Outputs:** append-only Annotations. Nothing else — no follow-up actions, no fix suggestions (non-goal).

## 3. Two-Tier Design

**Tier 1 — Heuristics (deterministic, always on):**
Ordered rule list, each rule: predicate over the evidence packet → label + fixed confidence + ruleId. Examples: divergence path matches a value the code diff literally changed (string/number moved from old hunk to new) → `intended`; probe exercises only files untouched by the diff → `collateral` (high confidence — the scariest kind of regression); previously suppressed stableId → `intended`. Rules are data-registered (OCP), individually tested, and their ruleId appears in the annotation for auditability.

**Tier 2 — Local LLM (advisory, budgeted):**
Only divergences unresolved by Tier 1. Batched per probe (shared code-diff context), schema-constrained output (the provider is asked for structured JSON; invalid output → one retry → `uncertain`). Hard wall-clock budget for the whole tier (config, default ~60s); budget exhaustion marks the remainder `uncertain(budget)`.

**Why tiers:** the easy majority is classified deterministically (faster, free, and *more* trustworthy), shrinking the AI surface — the architecture makes AI progressively less load-bearing as the rule library grows.

## 4. Model & Provider Abstraction

Two separated ports (SRP):

- **`InferenceProvider`** (in `inference/`): transport-level — `capabilities()` (models present, context length, structured-output support), `complete(request, signal)`. Implementations: Ollama (v1), llama.cpp server, LM Studio (later). All loopback HTTP; the provider layer *rejects* non-loopback endpoints by construction (L3).
- **`IntentClassifier`** (in `classify/`): judgment-level — owns evidence packet assembly, prompt templates, output parsing, calibration.

**Prompt lifecycle (no prompt content here):** templates are versioned artifacts in the repo (`classify/templates/`), keyed by template id + version; the annotation records template version + model id, so classification quality is regression-testable against the curated eval set (Doc 13) when either changes. Template changes go through the same PR review as code.

## 5. Confidence & Calibration

- Heuristic confidences are fixed per rule (assigned from eval-set measurement, not vibes).
- LLM confidence: model-reported self-scores are known to be poorly calibrated; v1 maps model output to coarse bands (high/medium/low → 0.9/0.6/0.3) and the verdict renderer treats anything below a config threshold as `uncertain`. Honest coarse bands beat fake precision.
- The eval corpus (labeled divergences with ground-truth intent) is a first-class repo artifact; CI reports precision/recall per tier so classifier changes are measured, not felt.

## 6. Failure Handling & Fallback Ladder

1. Provider unreachable at check start → skip Tier 2 entirely, verdict notes `classification: heuristics-only`.
2. Per-call timeout/error → one retry → `uncertain(inference_error)`.
3. Model absent (not pulled) → same as (1) + remediation hint (`ollama pull <default>`), never auto-download (surprise multi-GB fetches violate user consent expectations).
4. Malformed output → retry once with repair instruction → `uncertain(malformed)`.
5. Circuit breaker: N consecutive failures disables Tier 2 for the rest of the run.

Every fallback is visible in the verdict — silent degradation is the one failure mode an oracle can't have.
