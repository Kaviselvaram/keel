# ADR-002: MCP as the primary interface

> Status: Accepted · Frozen in Architecture v1.0 (2026-07-12) · Source: [Doc 15](../architecture/15-adrs.md)

**Context:** The consumer is an AI coding agent in an edit loop. **Decision:** MCP server (stdio) as first-class surface; CLI shares the identical service layer. **Alternatives:** CLI-only (agents *can* shell out, but lose structured results, progress, and discoverability); bespoke HTTP API (no ecosystem pull); LSP-style protocol (wrong shape — KEEL is not editor-positional). **Consequences:** exposure to MCP spec churn, quarantined in one compat seam (Doc 09 §5); free integration with every MCP host.
