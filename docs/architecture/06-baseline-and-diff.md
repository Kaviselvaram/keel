# KEEL — Baseline Engine & Diff Engine

> Document 06 · Status: FROZEN — Architecture v1.0 (2026-07-12)

---

# Part A — Baseline Engine

## A1. Capture Lifecycle

`resolve → fingerprint → execute (record mode) → normalize → serialize → hash → persist (tx) → verify → seal`

Each stage detailed in Docs 02 §5 and 04. Key decisions:

- **Verification replay before sealing** (immediate re-run(s), expect zero divergences). Converts nondeterminism from a trust-destroying runtime false positive into a capture-time diagnostic naming the exact flapping path. Verification count is configurable: default **2**, recommended **5** in CI (one clean re-run is weak statistical evidence — freeze amendment per review). Cost: (1+N)× capture time. Accepted.
- **Atomicity:** a baseline is visible only when sealed. Crash mid-capture leaves a `capturing` row that GC reaps; readers never see partial baselines.

## A2. Input Generation

v1 inputs are **declared, not generated**: the probe's invocation *is* the input (args, stdin file/inline, fixture files). Sources in priority order:

1. Explicit probes in `keel.config` (primary).
2. `keel init` scaffolding: inspects the repo (package.json scripts, bin entries, test commands) and *proposes* probes — the developer confirms. Proposal may use the local LLM; the confirmed probe is plain data (L1: generated *suggestions*, executed *facts*).
3. Future: harvesting from test runs, trace-derived probes, LLM-assisted input synthesis — all reduce to "more declared probes," so the model doesn't change.

**Why not automatic input synthesis in v1:** unowned inputs produce unowned baselines; when a divergence appears in a probe the developer never blessed, they can't judge it. Ownership of inputs is what makes the oracle's question answerable (YAGNI + product logic, not just scope control).

## A3. Recording, Serialization, Hashing

- Raw observations stream to spill files (bounded memory), then normalize → canonical JSON (sorted keys; numbers with explicit formatting rules; binary as hash-referenced attachments, never inline base64 for >1KB).
- Hashing: SHA-256 over canonical bytes; snapshot hash is a Merkle root over observation hashes. Consequences: O(1) snapshot equality, per-observation dedup in CAS, subtree short-circuiting in diff.
- Stream contents get structure-sniffing at normalization time: stdout that parses as JSON/NDJSON is stored *both* as raw text hash and parsed canonical tree — the diff engine prefers the tree (semantic diffs like `$.items[3].price`), falls back to line diff. Sniffing result is recorded in the snapshot so replay uses the same interpretation (no flip-flopping between parse modes).

## A4. Replayability & Versioning

A baseline is replayable iff: probe spec hash matches or is explicitly migrated; runner capabilities ⊇ baseline's required interceptors; environment fingerprint compatible. **Fingerprint compatibility is per-field policy** (`strict` = refuse / `warn` = proceed-and-flag / `ignore`), configurable, with measured defaults: config hash `strict`; runtime major, OS, arch `strict`; runtime minor/patch `warn`; git commit `warn` (checking an edited working tree against a baseline from an older commit is the primary use case — refusing would be staleness fatigue; the verdict records `ancestor-drift`). The fingerprint also includes ICU/locale-data version (freeze amendment: `Intl` output changes with locale data, not just runtime version). Hard failures → `stale-baseline` with per-field mismatch report. Baselines carry `schemaVersion` + `normalizationRulesetVersion`; the store migrates *metadata* forward but never rewrites snapshot content — a baseline that can't be honestly compared is retired, not silently converted.

---

# Part B — Diff Engine

## B1. Design Invariants

1. **Pure:** `(baselineSnapshot, candidateSnapshot, rules) → Divergence[]` with no I/O, no clock, no randomness, no logging.
2. **Deterministic output order:** divergences sorted by (probe, observation kind, path) — byte-identical reports for identical inputs (L4; also makes verdicts diffable artifacts themselves).
3. **Normalization happens at capture, not diff.** The diff engine compares canonical forms only. Rationale: normalizing at diff time means the stored baseline is "dirty" and every consumer must re-normalize; capture-time normalization gives one blessed representation and lets verification replay validate the ruleset itself. Ignore *rules* still apply at diff time (they are per-check policy, e.g. a temporary suppression pattern), but volatile-value *scrubbing* (timestamps, PIDs, addresses, temp paths) is capture-time.

## B2. Comparison Model

- **Dispatcher walks the snapshot pair** by observation kind; a **comparator registry** (OCP) holds one comparator per kind: exit comparator, structured-tree comparator (JSON), text comparator (line-based, Myers), fs-effect comparator (path-keyed set diff), net-call comparator (sequence-aligned with request-shape matching).
- **Hash short-circuit at every level:** equal Merkle nodes are skipped without descent. Expected dominant case (most probes unchanged) costs one hash compare per probe.
- **Structured trees:** keyed objects diff by key; arrays diff by LCS with optional user-declared identity keys (`items[] by .id`) from config — positional diffs on reordered arrays are the classic false-positive generator, so identity-keyed matching is in v1.

## B3. Divergence Taxonomy (output categories)

| Kind | Meaning |
|------|---------|
| `value-changed` | same path, different scalar |
| `shape-changed` | type/structure changed at path |
| `entry-added` / `entry-removed` | key/element/effect appeared or vanished |
| `order-changed` | same multiset, different sequence (only where order is significant per rules) |
| `effect-added` / `effect-removed` / `effect-changed` | fs/net side-effect delta |
| `unrecorded-effect` | replay attempted an effect with no recording (new network call) |
| `exit-changed` | exit status delta |
| `probe-failed` | candidate execution failed where baseline succeeded (or vice versa) |

Taxonomy is closed and versioned: classifiers, suppressions, and renderers key off it, so additions are minor-version events with explicit handling in each consumer.

## B4. Performance Posture

Diff is not the bottleneck (execution is). Still: hash short-circuit, streaming line diff for large texts with a size ceiling above which KEEL reports `content-changed (too large to structure)` with both hashes — a *policy* to avoid pathological Myers runtimes, stated honestly in the verdict rather than hidden by sampling.
