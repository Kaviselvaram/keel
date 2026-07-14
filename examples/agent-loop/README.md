# Example: the agent loop over MCP

The dialogue an AI coding agent has with KEEL mid-edit: **status → capture → edit → check → explain → suppress → check**. [`run.mjs`](run.mjs) speaks raw newline-delimited JSON-RPC to a spawned `keel mcp` — no SDK required — and prints each tool's summary line plus progress notifications.

```
corepack pnpm build          # from the repo root
node examples/agent-loop/run.mjs
```

What to notice: the second `keel_check` returns `status:"diverged"` with a `stableId` the agent feeds to `keel_explain` (full values) and then to `keel_suppress` (accepting the change); the final check still records the divergence as fact but reports `unsuppressedCount: 0` — exactly the semantics CI uses. Protocol details: [docs/guides/mcp.md](../../docs/guides/mcp.md); result shapes: [docs/guides/verdict-format.md](../../docs/guides/verdict-format.md); host wiring is two lines of MCP-server config (`command: "keel", args: ["mcp"]`).
