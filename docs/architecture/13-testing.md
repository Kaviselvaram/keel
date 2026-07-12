# KEEL — Testing Strategy

> Document 13 · Status: FROZEN — Architecture v1.0 (2026-07-12)

An oracle's product *is* its trustworthiness; the test suite is therefore the most important code in the repo. Layers, innermost first:

| Layer | Scope & policy |
|-------|----------------|
| **Unit** | Ring 0–1 modules, colocated (`src/x/__tests__`). Diff and model are pure → exhaustive table-driven tests. No mocking frameworks for domain types; hand-rolled fakes for ports (mock-heavy tests couple to implementation). |
| **Property tests** (fast-check) | The determinism laws as properties: `diff(s,s) = []` for arbitrary snapshots; `diff` output invariant under input construction order; canonical serialization stable across runs/platform (`hash(canon(x)) = hash(canon(shuffle(x)))`); normalization idempotent (`norm(norm(x)) = norm(x)`). These properties *are* L4 — they get the largest generator budgets. |
| **Golden/snapshot tests** | Canonical serialization bytes, verdict document schema, MCP tool request/response schemas, CLI human output. Golden files are reviewed diffs — an unacknowledged byte change in canonical form is a data-compat break caught at PR time. |
| **Contract tests** | Every port ships a reusable conformance kit: `Runner` contract (determinism under repetition, cap enforcement, cancellation ≤ grace window, schema conformance — the executable LSP guarantee for third-party runners), repository contracts (run against real SQLite in-memory), `InferenceProvider` contract (against a recorded Ollama stub). |
| **Integration** | Engine pipelines with real storage + real subprocesses over `tests/fixtures/` mini-repos (a Node CLI, a JSON API script, a deliberately flaky app that capture *must reject*, a secrets-echoing app that scrubbing must catch). |
| **Regression corpus** | `tests/regression-corpus/`: curated cases of (repo state, edit, expected divergences, expected labels). Measures true-regression recall and classification precision (Doc 00 metrics). Every user-reported false positive/negative becomes a corpus case before it's fixed — the corpus only grows. |
| **E2E** | Black-box: install the packed tarball, run real CLI and a real MCP client session against examples/, on the 3-OS CI matrix. Includes the **zero-egress test**: run the full suite inside a network-namespace/firewall harness that fails on any non-loopback connection attempt (L3 as CI). |
| **Determinism gate** | Dedicated CI job: capture → replay ×20 on fixture repos across OS matrix; any flap fails the build with the flapping path. This is the 99.5% metric, enforced continuously. |
| **Architecture validation** | dependency-cruiser rules (all forbidden edges from Doc 01 §3); the "AI-deletable" build (compile + deterministic tests with `classify/`+`inference/` excluded — L2 as CI); public-API surface lockfile (api-extractor style) so accidental export changes are reviewed. |
| **Performance** | `@keel/bench` budgets (Doc 12 §2) as CI gates on the reference machine class. |
| **Classifier eval** | Labeled eval set; precision/recall per tier reported on every PR touching templates, rules, or default model — classifier quality changes are measured, never merged on vibes. |

**Meta-policy:** KEEL dogfoods itself from Phase 5 onward — the repo carries its own `keel.config`, and CI runs `keel check` on KEEL. The oracle that doesn't trust itself with itself shouldn't ship.
