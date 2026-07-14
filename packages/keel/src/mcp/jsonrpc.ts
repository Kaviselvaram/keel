/**
 * Newline-delimited JSON-RPC 2.0 framing for stdio (Doc 09 §2). Pure
 * transport: parse, type, and write — zero routing or domain knowledge.
 */

export type JsonRpcId = string | number;

export interface JsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id: JsonRpcId;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

export interface JsonRpcNotification {
  readonly jsonrpc: '2.0';
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

export type JsonRpcIncoming = JsonRpcRequest | JsonRpcNotification;

export function parseIncoming(line: string): JsonRpcIncoming | { readonly parseError: string } {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (error) {
    return { parseError: error instanceof Error ? error.message : 'invalid JSON' };
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    (value as { jsonrpc?: unknown }).jsonrpc !== '2.0' ||
    typeof (value as { method?: unknown }).method !== 'string'
  ) {
    return { parseError: 'not a JSON-RPC 2.0 request' };
  }
  return value as JsonRpcIncoming;
}

export function isRequest(incoming: JsonRpcIncoming): incoming is JsonRpcRequest {
  return 'id' in incoming && (typeof incoming.id === 'string' || typeof incoming.id === 'number');
}

export interface LineWriter {
  write(line: string): void;
}

/** One message per line; the only writer to stdout in the MCP process. */
export function writeMessage(writer: LineWriter, message: Record<string, unknown>): void {
  writer.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
}
