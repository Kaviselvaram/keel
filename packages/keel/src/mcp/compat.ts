/**
 * The MCP protocol-revision compatibility seam (Doc 09 §5): every assumption
 * about the wire protocol's evolution lives HERE, so spec churn touches one
 * file. KEEL speaks newline-delimited JSON-RPC 2.0 over stdio and negotiates
 * the protocol revision at initialize.
 */

/** Revisions this build understands, newest first. */
export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;

export type ProtocolVersion = (typeof SUPPORTED_PROTOCOL_VERSIONS)[number];

/**
 * Per spec: echo the client's revision when supported; otherwise answer with
 * our newest (the client then decides whether to proceed).
 */
export function negotiateProtocolVersion(requested: unknown): ProtocolVersion {
  if (
    typeof requested === 'string' &&
    (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
  ) {
    return requested as ProtocolVersion;
  }
  return SUPPORTED_PROTOCOL_VERSIONS[0];
}

/** Capabilities advertised at initialize (tools only in v1; resources are a documented later option). */
export const SERVER_CAPABILITIES = { tools: { listChanged: false } } as const;

/** JSON-RPC error codes used for PROTOCOL errors only (Doc 09 §4 — domain outcomes are successful results). */
export const JSONRPC_ERRORS = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
} as const;
