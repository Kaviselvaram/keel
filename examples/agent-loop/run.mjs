/**
 * The agent loop, scripted (Doc 24 P6): spawn `keel mcp`, capture a baseline
 * of a tiny app, "edit" the app, ask the oracle what changed, accept the
 * change. Exactly the JSON-RPC dialogue an MCP host performs.
 *
 * Run from the repo root after a build:  node examples/agent-loop/run.mjs
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../packages/keel/dist/cli/main.js');
const cwd = mkdtempSync(path.join(tmpdir(), 'keel-agent-loop-'));
const app = path.join(cwd, 'app.cjs');
writeFileSync(app, `console.log(JSON.stringify({greeting:'hello',version:1}))`);
writeFileSync(
  path.join(cwd, 'keel.config.jsonc'),
  JSON.stringify({ version: 1, probes: { app: { command: process.execPath, args: [app] } } }),
);

const server = spawn(process.execPath, [cli, 'mcp'], { cwd, stdio: ['pipe', 'pipe', 'inherit'] });
const pending = new Map();
let nextId = 1;
createInterface({ input: server.stdout }).on('line', (line) => {
  const message = JSON.parse(line);
  if (message.method === 'notifications/progress') {
    console.log(`  … ${message.params.message}`);
    return;
  }
  pending.get(message.id)?.(message);
});
const request = (method, params) =>
  new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
const call = async (name, args = {}) => {
  console.log(`\n>> ${name} ${JSON.stringify(args)}`);
  const { result } = await request('tools/call', {
    name,
    arguments: args,
    _meta: { progressToken: nextId },
  });
  console.log(`<< ${result.content[0].text}`);
  return result.structuredContent;
};

await request('initialize', { protocolVersion: '2025-06-18' });
server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);

await call('keel_status');
await call('keel_capture', { label: 'agent-demo' });
await call('keel_check', { label: 'agent-demo' }); // clean

console.log('\n-- the agent edits the app (version 1 -> 2) --');
writeFileSync(app, `console.log(JSON.stringify({greeting:'hello',version:2}))`);

const verdict = await call('keel_check', { label: 'agent-demo' }); // diverged
const stableId = verdict.report.divergences[0].divergence.stableId;
await call('keel_explain', { stableId });
await call('keel_suppress', { stableId, reason: 'version bump is the intended change' });
await call('keel_check', { label: 'agent-demo' }); // diverged, 0 unsuppressed

server.stdin.end();
await new Promise((resolve) => server.once('exit', resolve));
rmSync(cwd, { recursive: true, force: true });
console.log('\nagent loop complete');
