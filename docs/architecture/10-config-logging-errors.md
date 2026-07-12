# KEEL — Configuration, Logging, Error Handling

> Document 10 · Status: FROZEN — Architecture v1.0 (2026-07-12)

---

# Part A — Configuration System

## A1. Sources & Override Hierarchy (lowest → highest)

1. Built-in defaults (in code, exhaustive — every knob has one).
2. Project file: `keel.config.json` (or `.jsonc`) at repo root. **JSON, not JS/TS config:** config participates in baseline provenance via hashing; executable config is unhashable-in-principle, nondeterministic, and a code-execution surface. Losing "computed config" is the accepted trade.
3. User file: `~/.config/keel/config.json` — machine-local preferences only (inference endpoint, log level). Probes and normalization rules are **forbidden** here: behavior-affecting config must live with the repo or baselines aren't shareable/reproducible. The loader enforces this split by schema.
4. Environment: `KEEL_*` (CI ergonomics: `KEEL_LOG_LEVEL`, `KEEL_INFERENCE_URL`, `KEEL_NO_CLASSIFY`, `KEEL_STORE_DIR` for out-of-tree store relocation). Same behavior-affecting restriction.
5. Invocation flags / MCP params (highest; same restriction).

## A2. Validation & Snapshot

Single schema (Zod-style, one source of truth generating JSON Schema for docs/editor autocomplete). Load → merge → validate → **freeze** into an immutable `ConfigSnapshot`; unknown keys are hard errors (typo'd `ignoreRulez` silently doing nothing is an oracle-integrity bug, not a convenience). The snapshot's **behavior-affecting subset** is canonically hashed → `configHash` in baseline provenance. The hash is computed over the **canonicalized parsed document** — comments and formatting in the JSONC source can never invalidate a baseline (ADR-011); presentation-only keys (log level, colors) are excluded from the hash so cosmetic changes don't invalidate baselines. Errors report path + expected + received + docs link.

---

# Part B — Logging (Observability)

- **Structured NDJSON** to `.keel/logs/keel-<date>.log` (rotated, capped); human-pretty rendering only on CLI stderr at `info`+. Levels: `error, warn, info, debug, trace`.
- **Correlation:** every ingress mints an `opId` (ULID); every log line and every persisted entity created under it carries it — one grep reconstructs a check. Probe executions add `probeName` + `executionId`.
- **Spans:** lightweight begin/end timing records per phase (replay, diff, classify, per-probe); the same numbers land in `verdict.timing` — the verdict is the user-facing performance report, logs are the debugging one.
- **Injection, not globals:** a `Logger` port passed at construction (Ring 0–1 stay pure; diff takes no logger by design — callers time it).
- **Redaction at the edge:** env values and stdin payloads are never logged above `trace`, and `trace` prints a hash unless `KEEL_UNSAFE_LOG_VALUES=1`. **No telemetry of any kind exists; a CI zero-egress test enforces it (L3).**

---

# Part C — Error Handling

## C1. Hierarchy (typed, from `shared/`)

```
KeelError
├── UserError          # bad config, unknown probe, missing runner — exit 2, remediation attached
├── EnvironmentError   # ollama down, sqlite locked, disk full — recoverable/degradable
├── ExecutionFault     # engine-level spawn/injection failure (≠ user code failing, which is data)
├── IntegrityError     # CAS hash mismatch, provenance conflict — never auto-heal, quarantine + report
└── InternalError      # invariant violation — a KEEL bug; crash loudly with report bundle
```

## C2. Policies

- **Recoverable:** `EnvironmentError` in advisory paths degrades (classification skipped, noted in verdict). In deterministic paths it fails the operation cleanly — a half-executed check is never presented as a verdict.
- **User errors** are product surface: message = what, why, exactly how to fix, docs link. Error message quality is reviewed like API design (DX is a listed goal, this is where it lives).
- **Developer errors** (`InternalError`) never degrade silently: fail fast, write a diagnostics bundle (`keel doctor --bundle`: logs, versions, config-hash — no user code content), ask for an issue report. An oracle that swallows its own bugs produces subtly wrong verdicts, the worst outcome available.
- **Boundary translation:** engines throw typed errors → services map to Verdict statuses or operation failures → adapters map to exit codes (0 clean / 1 diverged / 2 user / 3 environment / 4 internal) and MCP structured results. No raw stack trace ever reaches an adapter surface except at `debug`.
