/**
 * MCP protocol e2e (Doc 24 P6 acceptance): a real session against the built
 * `keel mcp` — handshake, the full tool loop (status → capture → check →
 * explain → suppress), busy semantics, cancellation, protocol errors, and
 * clean shutdown on stdin close.
 */

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const cliPath = fileURLToPath(new URL('../../../dist/cli/main.js', import.meta.url));
const distReady = existsSync(cliPath);
if (!distReady && process.env['CI'] !== undefined) {
  throw new Error('MCP e2e requires the built dist in CI — build must precede test');
}

interface ToolResult {
  readonly structuredContent: Record<string, unknown>;
  readonly isError?: boolean;
}

/** Minimal NDJSON JSON-RPC client for the session. */
class McpClient {
  private readonly child: ChildProcess;
  private readonly pending = new Map<number, (value: Record<string, unknown>) => void>();
  private nextId = 1;
  readonly exited: Promise<number | null>;

  constructor(cwd: string) {
    this.child = spawn(process.execPath, [cliPath, 'mcp'], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    createInterface({ input: this.child.stdout as NodeJS.ReadableStream }).on('line', (line) => {
      const message = JSON.parse(line) as Record<string, unknown>;
      if (typeof message['id'] === 'number') {
        this.pending.get(message['id'])?.(message);
        this.pending.delete(message['id']);
      }
    });
    this.exited = new Promise((resolve) => this.child.once('exit', (code) => resolve(code)));
  }

  private send(message: Record<string, unknown>): void {
    this.child.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  }

  request(method: string, params?: Record<string, unknown>): { id: number; response: Promise<Record<string, unknown>> } {
    const id = this.nextId++;
    const response = new Promise<Record<string, unknown>>((resolve) => this.pending.set(id, resolve));
    this.send({ id, method, ...(params === undefined ? {} : { params }) });
    return { id, response };
  }

  notify(method: string, params?: Record<string, unknown>): void {
    this.send({ method, ...(params === undefined ? {} : { params }) });
  }

  async call(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
    const { response } = this.request('tools/call', { name, arguments: args });
    return (await response)['result'] as ToolResult;
  }

  close(): void {
    this.child.stdin?.end();
  }
}

const clients: McpClient[] = [];
const dirs: string[] = [];
afterAll(async () => {
  for (const client of clients) client.close();
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 5 })));
});

async function workspace(script: string): Promise<{ cwd: string; scriptFile: string }> {
  const cwd = await mkdtemp(path.join(tmpdir(), 'keel-mcp-'));
  dirs.push(cwd);
  const scriptFile = path.join(cwd, 'app.cjs');
  await writeFile(scriptFile, script);
  await writeFile(
    path.join(cwd, 'keel.config.jsonc'),
    JSON.stringify({ version: 1, probes: { app: { command: process.execPath, args: [scriptFile] } } }),
  );
  return { cwd, scriptFile };
}

describe.skipIf(!distReady)('MCP server end-to-end', () => {
  it('walks the full agent loop: handshake → status → capture → check → explain → suppress', async () => {
    // Text output: whole-stream divergence refs are real CAS objects, so
    // keel_explain can retrieve both sides (leaf-JSON refs are identity-only
    // in v1 — the documented limitation).
    const { cwd, scriptFile } = await workspace(`console.log('value: 1')`);
    const client = new McpClient(cwd);
    clients.push(client);

    // Handshake + capability advertisement.
    const init = (await client.request('initialize', { protocolVersion: '2025-06-18' }).response)['result'] as Record<string, unknown>;
    expect(init['protocolVersion']).toBe('2025-06-18');
    expect((init['serverInfo'] as Record<string, unknown>)['name']).toBe('keel');
    client.notify('notifications/initialized');

    // tools/list matches the frozen surface.
    const tools = (await client.request('tools/list').response)['result'] as { tools: { name: string }[] };
    expect(tools.tools.map((tool) => tool.name)).toEqual([
      'keel_status',
      'keel_capture',
      'keel_check',
      'keel_explain',
      'keel_suppress',
    ]);

    // status: initialized, one probe, no baselines yet.
    const status = await client.call('keel_status');
    expect(status.structuredContent).toMatchObject({ status: 'ok', initialized: true, probeCount: 1 });

    // check before capture: a structured user-error outcome, not a protocol error.
    const early = await client.call('keel_check', { label: 'agent' });
    expect(early.structuredContent).toMatchObject({ status: 'error', errorClass: 'user', code: 'KEEL_E_CHECK_NO_BASELINE' });

    // capture with progress notifications.
    const capture = await client.call('keel_capture', { label: 'agent' });
    expect(capture.structuredContent['status']).toBe('sealed');

    // clean check.
    const clean = await client.call('keel_check', { label: 'agent' });
    expect(clean.structuredContent['status']).toBe('clean');

    // the edit → diverged with a stableId.
    await writeFile(scriptFile, `console.log('value: 2')`);
    const diverged = await client.call('keel_check', { label: 'agent' });
    expect(diverged.structuredContent['status']).toBe('diverged');
    const report = diverged.structuredContent['report'] as {
      divergences: { divergence: { stableId: string; kind: string } }[];
      unsuppressedCount: number;
    };
    expect(report.unsuppressedCount).toBe(1);
    const stableId = report.divergences[0]?.divergence.stableId ?? '';

    // explain retrieves the values.
    const explain = await client.call('keel_explain', { stableId });
    const detail = explain.structuredContent['explain'] as {
      formattedPath: string;
      baselineValue: { present: boolean; text?: string };
      candidateValue: { present: boolean; text?: string };
    };
    expect(detail.formattedPath).toBe('stream:stdout/text');
    expect(detail.baselineValue.present).toBe(true);
    expect(detail.baselineValue.text).toContain('value: 1');
    expect(detail.candidateValue.text).toContain('value: 2');

    // suppress, then the same check shows zero unsuppressed.
    const suppressed = await client.call('keel_suppress', { stableId, reason: 'v2 accepted' });
    expect(suppressed.structuredContent['status']).toBe('created');
    const after = await client.call('keel_check', { label: 'agent' });
    expect((after.structuredContent['report'] as { unsuppressedCount: number }).unsuppressedCount).toBe(0);

    // protocol errors: unknown tool, invalid params.
    const unknown = await client.request('tools/call', { name: 'keel_teleport', arguments: {} }).response;
    expect((unknown['error'] as { code: number }).code).toBe(-32602);
    const badParams = await client.request('tools/call', { name: 'keel_capture', arguments: { label: 5 } }).response;
    expect((badParams['error'] as { message: string }).message).toContain('arguments.label');

    // graceful shutdown on stdin close.
    client.close();
    expect(await client.exited).toBe(0);
  }, 120_000);

  it('reports busy for concurrent calls and honors cancellation', async () => {
    const { cwd } = await workspace(
      `setTimeout(()=>{console.log(JSON.stringify({slow:true}))},1500)`,
    );
    const client = new McpClient(cwd);
    clients.push(client);
    await client.request('initialize', { protocolVersion: '2025-06-18' }).response;
    client.notify('notifications/initialized');

    // Fire capture (slow: 3 executions × 1.5s), then status immediately → busy.
    const capture = client.request('tools/call', { name: 'keel_capture', arguments: { label: 'x' } });
    const busy = client.request('tools/call', { name: 'keel_status' });
    const busyResult = ((await busy.response)['result'] as ToolResult).structuredContent;
    expect(busyResult).toMatchObject({ status: 'busy', blocking: { tool: 'keel_capture' } });

    // Cancel the in-flight capture; it resolves with a structured cancelled outcome.
    client.notify('notifications/cancelled', { requestId: capture.id });
    const cancelled = ((await capture.response)['result'] as ToolResult).structuredContent;
    expect(cancelled).toMatchObject({ status: 'error', code: 'KEEL_E_CAPTURE_CANCELLED' });

    client.close();
    expect(await client.exited).toBe(0);
  }, 60_000);
});
