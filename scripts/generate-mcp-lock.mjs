/**
 * Regenerates the MCP tool-schema lockfile from the BUILT adapter
 * (Doc 09 §5: compatibility as a test). Regeneration is deliberate (C72):
 * run with --write, review the diff — a changed schema is a published-
 * contract event and needs a KEEL_MCP_SCHEMA_VERSION bump in the same PR.
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const { TOOL_DEFINITIONS, KEEL_MCP_SCHEMA_VERSION, SUPPORTED_PROTOCOL_VERSIONS } = await import(
  '../packages/keel/dist/mcp/index.js'
);

const lock = {
  keelMcpSchemaVersion: KEEL_MCP_SCHEMA_VERSION,
  supportedProtocolVersions: SUPPORTED_PROTOCOL_VERSIONS,
  tools: TOOL_DEFINITIONS,
};

const target = fileURLToPath(new URL('../docs/reference/mcp-tools.lock.json', import.meta.url));
if (process.argv.includes('--write')) {
  writeFileSync(target, `${JSON.stringify(lock, null, 2)}\n`);
  console.log(`wrote ${String(lock.tools.length)} tool schemas to ${target}`);
} else {
  console.log(JSON.stringify(lock, null, 2));
}
