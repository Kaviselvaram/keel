# KEEL — Critical Architecture Review & Readiness

> Document 18 · Status: FROZEN — Architecture v1.0 (2026-07-12) · Self-review from five personas, then readiness scoring.

---

## 1. Google Staff Engineer

**"Your determinism story has a hole you're underplaying: the environment fingerprint is both too strict and too weak."** Too strict: fingerprinting runtime *versions* means every `nvm` bump strands baselines — expect risk #4 (staleness fatigue) to dominate real usage far more than Doc 16 admits. Too weak: it doesn't capture glibc/ICU/locale-data versions, which absolutely change `Intl` output. *Recommendation:* make fingerprint fields individually policy-configurable (`strict | warn | ignore` per field) with measured defaults, and add an ICU/locale probe to the fingerprint. Also: the verification replay is single-shot; one clean re-run is weak evidence of determinism. Make the verification count configurable (default 2, CI-recommended 5) — statistics, not ritual.

**Accepted.** Fingerprint policy levels and configurable verification count are adopted into Doc 06/A1 scope for Phase 4.

## 2. Cursor Engineer (agent-integration lens)

**"Your latency budget is unusable in an interactive agent loop."** 30s no-LLM is fine for a pre-commit gate, but agents want feedback per-edit, at conversational latency. Phase 12 (skipping) and 14 (watch mode) are where the product becomes real for us — they're scheduled too late. Also, `keel_check`'s all-probes default invites agents to burn minutes; the default should be diff-scoped from day one, even with the crude heuristic of path-prefix matching before the real dependency map exists. *Second:* agents need a `keel_probe_propose` tool — you made probe authoring the #2 risk and then gave the agent no MCP surface to help fix it.

**Partially accepted.** Crude diff-scoped default: adopted into Phase 6. `keel_probe_propose` (returns *proposals*, never writes config): adopted into Phase 11. Pulling P12 earlier: rejected — soundness of skipping depends on the deep runner's module graph (P7); crude path-scoping bridges the gap.

## 3. Qodo Architect (verification-product lens)

**"Process-boundary capture will disappoint on the projects that need KEEL most."** Real regressions hide in services with databases and queues — where stdout/exit-code probes see nothing and network recording hits stateful backends that make replay lie (the recorded DB response is stale the moment the schema migrates). The doc waves at this with `stub` mode but doesn't confront that **stateful dependencies are the determinism problem**, not clocks. *Recommendation:* be explicit in scope docs that v1 targets CLIs, pure services, and functions-with-fixtures; add "fixture lifecycle hooks" (setup/teardown commands per probe, e.g. seed a docker-compose DB) to the probe model *now*, because retrofitting probe schema hurts. Baselines should record fixture-hook hashes.

**Accepted.** Probe model gains optional `setup`/`teardown` hooks with hashed scripts in Phase 4 schema (cheap now, expensive later), and Doc 00 scope language will name the target project classes honestly.

## 4. Microsoft Principal Engineer (platform/enterprise lens)

**"Windows is scheduled as a parity task but designed as an afterthought,"** and it shows: process groups (P2) vs Job Objects (P10) means eight phases of a known-broken kill path on one of three tier-1 platforms; shadow-workdir copy-on-write "where supported" is doing a lot of unexamined work on NTFS; `libfaketime-style where available` is effectively "not on Windows." *Recommendation:* move Job Objects into Phase 2 (kill semantics are foundational, not hardening), and declare clock interception a *Node-runner capability only* rather than implying the command runner half-has it. Also, `.keel/` inside the repo will fight corporate file-sync/AV agents — allow an out-of-tree store location override (env) early.

**Accepted in full.** Job Objects → Phase 2; command-runner clock claims removed (capability honestly absent); `KEEL_STORE_DIR` override added to config scope.

## 5. OSS Maintainer

**"You designed a cathedral; who's holding it up?"** Eighteen architecture docs, four contract suites, a benchmark package, an eval corpus, 3-OS determinism gates — this is a beautiful load for a funded team and a crushing one for two maintainers. The realistic failure mode isn't a bad boundary, it's CI that takes 40 minutes and contributors who can't run the determinism gate locally. *Recommendations:* (1) tier CI — fast lane (<5 min: lint, unit, property-smoke) on every PR, full matrix on merge queue/nightly; (2) cut `@keel/bench` as a separate package until Phase 11, keep it a folder; (3) the eval corpus needs a labeling *process*, not just a folder — decide now that corpus PRs require two-maintainer label agreement, or the ground truth rots; (4) resist the three-package workspace until `runner-sdk` actually ships (P15) — start single-package, extract at P7 when the preload needs the types. 

**Accepted:** CI tiering, bench-as-folder, corpus labeling process. **Rejected:** deferring the workspace split — `runner-sdk` types are needed by the *Node preload* at P7 and the split is cheapest at P0; the maintainer's cost concern is real but the workspace overhead at three packages is near-zero with pnpm.

---

## 6. Cross-cutting weaknesses the personas missed (self-critique)

1. **Concurrent baseline semantics are underspecified:** two branches, one `.keel/` — label-based resolution ("latest for this branch") is mentioned but branch-switching UX (worktrees, rebases, stashes) needs a design note before Phase 5, or verdicts will compare across branches silently. *Must-decide before implementation.*
2. **The code-diff provenance is loose:** verdicts reference "the git diff evaluated," but KEEL runs against a *working tree* that can mutate mid-check. Decide: snapshot the tree (cost) or record tree-hash-at-start and mark verdicts `tree-mutated` when it changes (honesty). Recommend the latter.
3. **Suppression semantics vs. baseline refresh interact confusingly** (a suppressed divergence "disappears" after re-capture because it's now the baseline — is the suppression consumed? expired? warned about?). Needs a one-page state design.
4. **No offline verdict-format spec doc is scheduled** — the verdict is consumed by third-party agents; its schema deserves the same reference-doc treatment as the MCP tools (fold into Phase 6 docs).

---

## 7. Architecture Readiness Score

| Dimension | Score | Note |
|-----------|-------|------|
| Problem definition & scope discipline | 95% | laws + non-goals are sharp and enforceable |
| Core determinism design | 85% | strong model; fingerprint policy & stateful-deps honesty just patched via review |
| Module boundaries & testability | 90% | CI-enforced, contract-tested |
| Data model & persistence | 85% | branch semantics + suppression lifecycle open |
| MCP & agent ergonomics | 80% | latency story thin until P12/P14; probe-propose adopted late |
| Security honesty | 85% | honest threat model; OS sandbox correctly deferred |
| Ops burden realism | 75% | maintainer critique stands; CI tiering adopted but staffing risk remains |
| **Overall** | **86%** | |

## 8. Must-decide before writing code

> **Freeze note (2026-07-12):** all six items below were resolved at architecture freeze — see Doc 19 (resolution details) and ADRs 011–016 in Doc 15. This section is retained as the historical record of the open questions.

1. **Branch/worktree baseline semantics** (§6.1) — blocks storage schema (P3).
2. **Working-tree mutation policy during check** (§6.2) — blocks verdict schema (P5).
3. **Suppression lifecycle across re-capture** (§6.3) — blocks P8 schema.
4. **Config file format final call** (JSON vs JSONC vs TOML) — trivial but hash-relevant; decide at P0.
5. **Default model choice + minimum hardware statement** for the Ollama tier — blocks P9 eval targets and README honesty.
6. **License sign-off** (Apache-2.0 recommended) and governance (DCO) — blocks first public release.
