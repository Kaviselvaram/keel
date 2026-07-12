# ADR-001: TypeScript on Node.js

> Status: Accepted · Frozen in Architecture v1.0 (2026-07-12) · Source: [Doc 15](../architecture/15-adrs.md)

**Context:** Implementation language for an MCP-first developer tool. **Decision:** TypeScript (strict), Node LTS, ESM. **Alternatives:** Rust (better sandboxing/perf ceiling, but slower iteration, smaller contributor pool for an OSS dev-tool, and MCP/agent ecosystem gravity is TS); Go (good CLI story, weaker type modeling for the tagged-union-heavy Behavior Model). **Consequences:** native dep discipline required (better-sqlite3 only); perf ceiling accepted because probe execution, not KEEL code, dominates cost; direct code-sharing with the flagship Node runner's preload. Revisit trigger: if OS-level sandboxing becomes core (not opt-in), a Rust sidecar for the sandbox shim is the escape hatch — not a rewrite.
