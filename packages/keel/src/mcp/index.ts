/**
 * mcp/ — the MCP Server adapter (Ring 3, Doc 20 §12): stdio projection of
 * Application Services for AI agents. Zero business logic (C26); tool
 * schemas are the published, lockfile-frozen contract (Doc 09 §5).
 */

export { runMcpServer } from './main.js';
export type { RunMcpServerOptions } from './main.js';

export { TOOL_DEFINITIONS, KEEL_MCP_SCHEMA_VERSION, validateToolArguments } from './schemas.js';
export type { ToolDefinition, ValidationFailure } from './schemas.js';

export { SUPPORTED_PROTOCOL_VERSIONS, negotiateProtocolVersion } from './compat.js';
