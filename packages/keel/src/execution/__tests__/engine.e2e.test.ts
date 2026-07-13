/**
 * End-to-end engine tests against real child processes (this module's whole
 * job is process reality — mocking it would test nothing). `node -e` fixtures
 * keep everything cross-platform.
 */

import { describe, expect, it } from 'vitest';
import { access } from 'node:fs/promises';
import type { ExecutionRequest, StreamChunk } from '@keel/runner-sdk';
import { EnvironmentError } from '../../shared/index.js';
import { noopLogger } from '../../observability/index.js';
import { buildChildEnv } from '../env.js';
import { ExecutionEngine } from '../engine.js';
import { CommandRunner } from '../runners/command.js';
import { RunnerRegistry } from '../registry.js';

const engine = new ExecutionEngine({
  registry: new RunnerRegistry([new CommandRunner()]),
  logger: noopLogger,
});

const decoder = new TextDecoder();

function nodeRequest(script: string, overrides: Partial<ExecutionRequest> = {}): ExecutionRequest {
  return {
    command: process.execPath,
    args: ['-e', script],
    cwd: '',
    env: buildChildEnv({ base: process.env, allowlist: [], overrides: {} }),
    stdin: { kind: 'none' },
    limits: { timeoutMs: 10_000, maxOutputBytes: 1_048_576, maxFsEffectBytes: 10_485_760, graceMs: 300 },
    mode: 'record',
    interceptors: [],
    interceptorConfig: {},
    ...overrides,
  };
}

const run = (request: ExecutionRequest, signal?: AbortSignal) =>
  engine.execute(request, { runnerId: 'command', signal: signal ?? new AbortController().signal });

describe('execution engine e2e', () => {
  it('captures stdout, stderr, and exit code 0', async () => {
    const result = await run(nodeRequest(`console.log('out-line'); console.error('err-line');`));
    expect(result.exit).toEqual({ kind: 'exited', code: 0 });
    expect(decoder.decode(result.stdout)).toContain('out-line');
    expect(decoder.decode(result.stderr)).toContain('err-line');
    expect(result.stdoutTruncated).toBe(false);
  });

  it('propagates non-zero exit codes as data, not errors (C42)', async () => {
    const result = await run(nodeRequest('process.exit(3)'));
    expect(result.exit).toEqual({ kind: 'exited', code: 3 });
  });

  it('delivers stdin bytes', async () => {
    const result = await run(
      nodeRequest(
        `let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log('got:'+d));`,
        { stdin: { kind: 'bytes', bytes: new TextEncoder().encode('hello-stdin') } },
      ),
    );
    expect(decoder.decode(result.stdout)).toContain('got:hello-stdin');
  });

  it('env allowlist: a parent secret never reaches the child (C18)', async () => {
    const base = { ...process.env, KEEL_TEST_SECRET: 'leak-me' };
    const granted = nodeRequest(`console.log('secret=['+(process.env.KEEL_TEST_SECRET??'ABSENT')+']')`, {
      env: buildChildEnv({ base, allowlist: ['KEEL_TEST_SECRET'], overrides: {} }),
    });
    const denied = nodeRequest(`console.log('secret=['+(process.env.KEEL_TEST_SECRET??'ABSENT')+']')`, {
      env: buildChildEnv({ base, allowlist: [], overrides: {} }),
    });
    expect(decoder.decode((await run(granted)).stdout)).toContain('secret=[leak-me]');
    expect(decoder.decode((await run(denied)).stdout)).toContain('secret=[ABSENT]');
  });

  it('enforces timeouts as an exit status', async () => {
    const result = await run(
      nodeRequest('setInterval(()=>{},1000)', {
        limits: { timeoutMs: 400, maxOutputBytes: 65536, maxFsEffectBytes: 65536, graceMs: 200 },
      }),
    );
    expect(result.exit).toEqual({ kind: 'timeout' });
  }, 15_000);

  it('honors cancellation mid-run and pre-spawn (C44)', async () => {
    const controller = new AbortController();
    const pending = run(nodeRequest('setInterval(()=>{},1000)'), controller.signal);
    setTimeout(() => controller.abort(), 200);
    expect((await pending).exit).toEqual({ kind: 'cancelled' });

    const preAborted = new AbortController();
    preAborted.abort();
    const preSpawn = await run(nodeRequest(`console.log('never')`), preAborted.signal);
    expect(preSpawn.exit).toEqual({ kind: 'cancelled' });
    expect(preSpawn.stdout.byteLength).toBe(0);
  }, 15_000);

  it('truncates runaway output live and reports output-limit (Doc 24 P2 acceptance)', async () => {
    const result = await run(
      // Flood respecting backpressure: a sync for(;;) never yields, so bytes
      // would never leave the child's pipe buffer (it OOMs before we see data).
      nodeRequest(
        `const s='x'.repeat(65536);(function w(){ while(process.stdout.write(s)); process.stdout.once('drain', w); })();`,
        {
          limits: { timeoutMs: 10_000, maxOutputBytes: 262_144, maxFsEffectBytes: 65536, graceMs: 200 },
        },
      ),
    );
    expect(result.exit).toEqual({ kind: 'output-limit' });
    expect(result.stdoutTruncated).toBe(true);
    expect(result.stdout.byteLength).toBeLessThanOrEqual(262_144);
  }, 20_000);

  it('kill leaves zero orphans — grandchild is dead after group/tree kill (Doc 24 P2 acceptance)', async () => {
    const script = `
      const { spawn } = require('child_process');
      const grandchild = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
      console.log('GRANDCHILD:' + grandchild.pid);
      setInterval(()=>{},1000);
    `;
    const result = await run(
      nodeRequest(script, {
        limits: { timeoutMs: 1_500, maxOutputBytes: 65536, maxFsEffectBytes: 65536, graceMs: 300 },
      }),
    );
    expect(result.exit).toEqual({ kind: 'timeout' });
    const match = /GRANDCHILD:(\d+)/.exec(decoder.decode(result.stdout));
    expect(match).not.toBeNull();
    const grandchildPid = Number(match?.[1]);

    // Poll: tree kill is asynchronous on Windows; give it up to 5s.
    const deadline = Date.now() + 5_000;
    let alive = true;
    while (alive && Date.now() < deadline) {
      try {
        process.kill(grandchildPid, 0);
        await new Promise((resolve) => setTimeout(resolve, 200));
      } catch {
        alive = false;
      }
    }
    expect(alive).toBe(false);
  }, 30_000);

  it('collects the fs manifest: created, modified, deleted', async () => {
    // The manifest is a net-effect diff of the run: create-then-delete inside
    // one run is invisible; modified/deleted against pre-materialized state is
    // unit-tested in manifest.test.ts (the command runner plans no files).
    const result = await run(nodeRequest(`
      const fs = require('fs');
      fs.writeFileSync('mutate.txt', 'v1');
      fs.writeFileSync('doomed.txt', 'bye');
      fs.writeFileSync('created.txt', 'new');
      fs.writeFileSync('mutate.txt', 'v2');
      fs.unlinkSync('doomed.txt');
      fs.mkdirSync('sub', { recursive: true });
      fs.writeFileSync('sub/nested.txt', 'deep');
    `));
    expect(result.exit).toEqual({ kind: 'exited', code: 0 });
    const byPath = Object.fromEntries(result.fsEvents.map((event) => [event.path, event.change]));
    expect(byPath['created.txt']).toBe('created');
    expect(byPath['mutate.txt']).toBe('created');
    expect(byPath['sub/nested.txt']).toBe('created');
    expect(byPath['doomed.txt']).toBeUndefined();
  });

  it('cleans up the workspace and never dirties the caller cwd (C45)', async () => {
    const result = await run(nodeRequest(`require('fs').writeFileSync('artifact.txt','x'); console.log(process.cwd())`));
    const childCwd = decoder.decode(result.stdout).trim();
    expect(childCwd).not.toBe(process.cwd());
    await expect(access(childCwd)).rejects.toThrow();
  });

  it('streams chunks live to the sink', async () => {
    const chunks: StreamChunk[] = [];
    await engine.execute(nodeRequest(`console.log('a'); console.error('b');`), {
      runnerId: 'command',
      signal: new AbortController().signal,
      onChunk: (chunk) => chunks.push(chunk),
    });
    expect(chunks.some((chunk) => chunk.stream === 'stdout')).toBe(true);
    expect(chunks.some((chunk) => chunk.stream === 'stderr')).toBe(true);
  });

  it('fingerprint is deterministic across runs and free of wall-clock (C7)', async () => {
    const first = await run(nodeRequest(`console.log('x')`));
    const second = await run(nodeRequest(`console.log('x')`));
    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.startedAtEpochMs).not.toBe(0);
    expect(JSON.stringify(first.conditions)).not.toContain(String(first.startedAtEpochMs));
  });

  it('unknown runner and failed negotiation are EnvironmentErrors', async () => {
    await expect(
      engine.execute(nodeRequest('1'), { runnerId: 'node', signal: new AbortController().signal }),
    ).rejects.toBeInstanceOf(EnvironmentError);
    await expect(run(nodeRequest('1', { interceptors: ['clock'] }))).rejects.toBeInstanceOf(
      EnvironmentError,
    );
  });
});
