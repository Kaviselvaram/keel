# ADR-013: Working-tree mutation during a check

> Status: Accepted · Frozen in Architecture v1.0 (2026-07-12) · Source: [Doc 15](../architecture/15-adrs.md)

**Context:** KEEL runs against a mutable working tree; unresolved item #2. **Decision:** record a tree-state digest (tracked files + probe-relevant untracked) at check start, re-verify at verdict assembly; on mismatch the verdict is flagged **`tree-mutated`** — facts still reported, flag prominent, agents instructed to re-check. **Alternatives:** snapshot/clone the tree per check (correct but heavy — copy cost on every check; revisit only if tree-mutated flags prove common in agent loops); file-locking (hostile, unenforceable). **Consequences:** cheap (one status walk), honest, and it *measures* how often the race matters before we pay to eliminate it.
