# KEEL — MCP Design

> Document 09 · Status: FROZEN — Architecture v1.0 (2026-07-12)

## 1. Role

MCP is KEEL's **primary interface** — the consumer is an AI coding agent mid-edit-loop. The MCP server is a Ring-3 adapter: zero business logic, pure projection of Application Services (identical semantics to the CLI by construction).

## 2. Transport & Lifecycle

- **Transport: stdio** (v1). The agent's host spawns `keel mcp` per workspace; process lifetime = session lifetime. Why stdio first: every relevant MCP client supports it, it inherits the user's local permissions, and it requires no port management or auth story. Streamable HTTP is a later additive transport for long-lived daemon setups (roadmap), gated on real demand (YAGNI).
- **Lifecycle:** initialize (capability + version handshake) → serve tool calls (long calls emit **progress notifications** — replay of 50 probes must not look hung) → shutdown on stdin close with abort fan-out to running subprocesses (no orphaned probe processes; process-group kill guarantees this).
- Concurrency: tool calls that mutate (`keel_capture`) or execute (`keel_check`) serialize per workspace via the storage lock; the server reports `busy` with the blocking operation's ID rather than queueing silently.

## 3. Tool Surface (v1 — deliberately small)

| Tool | Purpose | Notes |
|------|---------|-------|
| `keel_status` | Is KEEL initialized? Baseline freshness, probe count, inference availability | the agent's cheap "should I even check?" call |
| `keel_capture` | Seal a new baseline (optionally scoped to named probes) | destructive-ish → requires explicit `label`; returns provenance |
| `keel_check` | The flagship: replay + diff + classify against a baseline | params: baseline selector, probe filter, classify on/off, budget. **Default scope is diff-scoped** (freeze amendment): only probes plausibly affected by the current git diff run by default — a crude path-prefix heuristic until the Phase 12 dependency map, always sound-by-over-approximation; `all: true` forces full replay |
| `keel_probe_propose` *(v1.1, Phase 11)* | Inspect the repo and return probe *proposals* for the agent/human to confirm | returns data only — **never writes config** (freeze amendment: probe authoring is risk #2 and the agent needed a surface to help) |
| `keel_explain` | Deep detail for one divergence (`stableId`): full values, evidence, prior annotations | keeps `keel_check` responses small |
| `keel_suppress` | Record "this divergence is accepted" | append-only, reasoned |

**Design rules:** every result is the structured Verdict document (schema-versioned JSON) plus a short natural-language summary — the agent parses the former, the human transcript shows the latter. Tool inputs validated against published JSON Schema; results carry `schemaVersion`. No tool ever returns free-text-only. Resources (`keel://verdict/<id>`) may be exposed read-only later; tools are the v1 contract.

**Rejected:** exposing fine-grained tools (`keel_replay_probe`, `keel_diff`) — agents compose badly at that granularity and it leaks engine boundaries; the use-case layer is the right altitude.

## 4. Error Model

Two channels, per MCP semantics: **protocol errors** (JSON-RPC error codes) only for malformed requests/unknown tools; **domain outcomes** — including `stale-baseline`, `not-initialized`, `busy`, `partial` — are *successful tool results* with structured status + machine-readable `remediation` field (e.g., `{action: "capture", reason: "config-hash-mismatch"}`). Rationale: agents handle structured results far better than opaque errors, and a stale baseline is an oracle answer, not a transport failure.

## 5. Versioning & Compatibility

- Tool schemas carry `keel_schema_version` (semver). Additive fields = minor; breaking = new tool name version suffix only as last resort (`keel_check_v2`) with one-major deprecation overlap.
- The server pins the MCP protocol revisions it supports and negotiates at initialize; protocol-revision adaptation lives in one `mcp/compat` seam so spec churn (a real risk — the spec is young) touches one module.
- Golden-file tests freeze every tool's request/response schema; CI fails on unacknowledged schema drift (compatibility as a test, not a promise).
