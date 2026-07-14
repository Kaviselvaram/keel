/**
 * The MCP server (Doc 09, Doc 20 §12): stdio lifecycle, routing, and
 * serialization discipline. One in-flight tool call at a time — a second
 * call gets a structured `busy` result naming the blocking operation
 * (Doc 09 §2, never silent queueing). stdin close = session end: abort
 * fan-out reaches running probe subprocesses (group kill, no orphans).
 */

import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import { KeelError, UserError, ulid } from '../shared/index.js';
import type { Logger } from '../observability/index.js';
import { canonicalSerialize } from '../model/index.js';
import { JSONRPC_ERRORS, negotiateProtocolVersion, SERVER_CAPABILITIES } from './compat.js';
import { isRequest, parseIncoming, writeMessage } from './jsonrpc.js';
import type { JsonRpcId, JsonRpcRequest, LineWriter } from './jsonrpc.js';
import { KEEL_MCP_SCHEMA_VERSION, TOOL_DEFINITIONS, validateToolArguments } from './schemas.js';
import { TOOL_HANDLERS } from './tools.js';
import type { ToolRuntime } from './tools.js';

/** Per-call runtime factory + disposal — composition happens outside this module (C27). */
export interface ToolRuntimeFactory {
  acquire(signal: AbortSignal): Promise<{ runtime: ToolRuntime; release: () => Promise<void> }>;
}

export interface McpServerOptions {
  readonly input: Readable;
  readonly output: LineWriter;
  readonly logger: Logger;
  readonly serverVersion: string;
  readonly runtimeFactory: ToolRuntimeFactory;
}

interface InFlight {
  readonly requestId: JsonRpcId;
  readonly tool: string;
  readonly opId: string;
  readonly controller: AbortController;
}

export class McpServer {
  private readonly options: McpServerOptions;
  private inFlight: InFlight | null = null;

  constructor(options: McpServerOptions) {
    this.options = options;
  }

  /** Serves until stdin closes; resolves after abort fan-out completes. */
  run(): Promise<void> {
    return new Promise((resolve) => {
      const lines = createInterface({ input: this.options.input, crlfDelay: Infinity });
      const pending: Promise<void>[] = [];
      lines.on('line', (line) => {
        if (line.trim().length === 0) return;
        pending.push(this.dispatch(line));
      });
      lines.on('close', () => {
        this.inFlight?.controller.abort();
        void Promise.allSettled(pending).then(() => {
          this.options.logger.info('mcp.session.closed', {});
          resolve();
        });
      });
    });
  }

  private async dispatch(line: string): Promise<void> {
    const incoming = parseIncoming(line);
    if ('parseError' in incoming) {
      writeMessage(this.options.output, {
        id: null,
        error: { code: JSONRPC_ERRORS.parseError, message: incoming.parseError },
      });
      return;
    }
    if (!isRequest(incoming)) {
      // Notifications: cancellation is the only one with behavior.
      if (incoming.method === 'notifications/cancelled') {
        const requestId = incoming.params?.['requestId'] as JsonRpcId | undefined;
        if (this.inFlight !== null && this.inFlight.requestId === requestId) {
          this.options.logger.info('mcp.call.cancelled', { tool: this.inFlight.tool, opId: this.inFlight.opId });
          this.inFlight.controller.abort();
        }
      }
      return; // all other notifications (initialized, ...) are acknowledged silently
    }
    await this.handleRequest(incoming);
  }

  private async handleRequest(request: JsonRpcRequest): Promise<void> {
    const respond = (result: Record<string, unknown>): void =>
      writeMessage(this.options.output, { id: request.id, result });
    const respondError = (code: number, message: string, data?: Record<string, unknown>): void =>
      writeMessage(this.options.output, {
        id: request.id,
        error: { code, message, ...(data === undefined ? {} : { data }) },
      });

    switch (request.method) {
      case 'initialize':
        respond({
          protocolVersion: negotiateProtocolVersion(request.params?.['protocolVersion']),
          capabilities: SERVER_CAPABILITIES,
          serverInfo: { name: 'keel', version: this.options.serverVersion },
        });
        return;
      case 'ping':
        respond({});
        return;
      case 'tools/list':
        respond({ tools: TOOL_DEFINITIONS.map((tool) => ({ ...tool })) });
        return;
      case 'tools/call':
        await this.handleToolCall(request, respond, respondError);
        return;
      default:
        respondError(JSONRPC_ERRORS.methodNotFound, `method '${request.method}' is not supported`);
    }
  }

  private async handleToolCall(
    request: JsonRpcRequest,
    respond: (result: Record<string, unknown>) => void,
    respondError: (code: number, message: string, data?: Record<string, unknown>) => void,
  ): Promise<void> {
    const name = request.params?.['name'];
    const definition = TOOL_DEFINITIONS.find((tool) => tool.name === name);
    if (definition === undefined) {
      respondError(JSONRPC_ERRORS.invalidParams, `unknown tool '${String(name)}'`, {
        knownTools: TOOL_DEFINITIONS.map((tool) => tool.name),
      });
      return;
    }
    const args = (request.params?.['arguments'] ?? {}) as Record<string, unknown>;
    const failure = validateToolArguments(definition, args);
    if (failure !== undefined) {
      // Malformed input is a protocol error (Doc 09 §4); path-precise data.
      respondError(JSONRPC_ERRORS.invalidParams, `${failure.path}: ${failure.message}`, { ...failure });
      return;
    }

    if (this.inFlight !== null) {
      // Busy is a DOMAIN outcome (Doc 09 §2): successful result, blocking op named.
      const busy = {
        keelSchemaVersion: KEEL_MCP_SCHEMA_VERSION,
        status: 'busy',
        blocking: { tool: this.inFlight.tool, opId: this.inFlight.opId },
        remediation: { action: 'retry', detail: 'one KEEL operation runs at a time per workspace' },
      };
      respond({
        content: [
          { type: 'text', text: `busy: ${this.inFlight.tool} is running` },
          { type: 'text', text: canonicalSerialize(busy) },
        ],
        structuredContent: busy,
        isError: false,
      });
      return;
    }

    const controller = new AbortController();
    const opId = ulid();
    this.inFlight = { requestId: request.id, tool: definition.name, opId, controller };
    const progressToken = (request.params?.['_meta'] as Record<string, unknown> | undefined)?.['progressToken'];
    const onProgress = (progress: number, message: string): void => {
      if (progressToken === undefined) return;
      writeMessage(this.options.output, {
        method: 'notifications/progress',
        params: { progressToken, progress, message },
      });
    };

    this.options.logger.info('mcp.call.start', { tool: definition.name, opId });
    // The response is written only AFTER the runtime is released and inFlight
    // is cleared — otherwise a prompt follow-up request races into `busy`.
    let outcome: { summary: string; document: Record<string, unknown>; isError: boolean };
    try {
      const { runtime, release } = await this.options.runtimeFactory.acquire(controller.signal);
      try {
        const handler = TOOL_HANDLERS[definition.name];
        if (handler === undefined) {
          respondError(JSONRPC_ERRORS.invalidParams, `tool '${definition.name}' has no handler`);
          return;
        }
        outcome = await handler(runtime, args, { signal: controller.signal, onProgress });
        this.options.logger.info('mcp.call.finish', { tool: definition.name, opId, isError: outcome.isError });
      } finally {
        await release();
      }
      this.inFlight = null;
      respond({
        content: [
          { type: 'text', text: outcome.summary },
          { type: 'text', text: canonicalSerialize(outcome.document) },
        ],
        structuredContent: outcome.document,
        isError: outcome.isError,
      });
      return;
    } catch (error) {
      // KeelErrors from runtime acquisition (store locked, environment) are
      // domain outcomes (Doc 09 §4); anything else is an internal bug —
      // visible, attributed, never silent (C59).
      const detail = error instanceof Error ? error.message : String(error);
      const isDomain = error instanceof KeelError;
      this.options.logger.error(isDomain ? 'mcp.call.domain-error' : 'mcp.call.internal-error', {
        tool: definition.name,
        opId,
        detail,
      });
      const document = isDomain
        ? {
            keelSchemaVersion: KEEL_MCP_SCHEMA_VERSION,
            status: 'error',
            errorClass: error instanceof UserError ? 'user' : error.name,
            code: error.code,
            message: detail,
            ...(error instanceof UserError ? { remediation: error.remediation } : {}),
          }
        : {
            keelSchemaVersion: KEEL_MCP_SCHEMA_VERSION,
            status: 'internal-error',
            message: detail,
            remediation: { action: 'report', detail: 'this is a KEEL bug - please file an issue' },
          };
      this.inFlight = null;
      respond({
        content: [
          { type: 'text', text: `error: ${detail}` },
          { type: 'text', text: canonicalSerialize(document) },
        ],
        structuredContent: document,
        isError: true,
      });
    } finally {
      this.inFlight = null;
    }
  }
}
