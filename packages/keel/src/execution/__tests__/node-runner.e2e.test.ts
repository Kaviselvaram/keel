/**
 * Node deep runner, engine-level (Doc 24 P7): the interceptors against real
 * child processes — deterministic clock/RNG across runs, TZ/locale pinning,
 * side-channel report, tamper detection, module graph, and the fetch
 * record/stub/forbidden modes.
 */

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runnerContractChecks } from '@keel/runner-sdk';
import type { ExecutionRequest, InterceptorCapability } from '@keel/runner-sdk';
import { afterAll, describe, expect, it } from 'vitest';
import { noopLogger } from '../../observability/index.js';
import { buildChildEnv } from '../env.js';
import { ExecutionEngine } from '../engine.js';
import { RunnerRegistry } from '../registry.js';
import { deriveSeed, NodeRunner } from '../runners/node/node-runner.js';
import { parseSideChannel } from '../side-channel.js';

const engine = new ExecutionEngine({ registry: new RunnerRegistry([new NodeRunner()]), logger: noopLogger });
const decoder = new TextDecoder();
const cleanups: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
});

async function scriptFile(source: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'keel-node-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'probe.cjs');
  await writeFile(file, source);
  return file;
}

function request(
  file: string,
  interceptors: readonly InterceptorCapability[],
  overrides: Partial<ExecutionRequest> = {},
): ExecutionRequest {
  return {
    command: process.execPath,
    args: [file],
    cwd: '',
    env: buildChildEnv({ base: process.env, allowlist: [], overrides: {} }),
    stdin: { kind: 'none' },
    limits: { timeoutMs: 15_000, maxOutputBytes: 1_048_576, maxFsEffectBytes: 1_048_576, graceMs: 300 },
    mode: 'record',
    interceptors,
    interceptorConfig: {},
    ...overrides,
  };
}

const run = (req: ExecutionRequest) =>
  engine.execute(req, { runnerId: 'node', signal: new AbortController().signal });

describe('node runner planning', () => {
  for (const check of runnerContractChecks(new NodeRunner())) {
    it(`contract: ${check.name}`, () => {
      check.run();
    });
  }

  it('plans the preload file, stabilized env, and derived determinism config', () => {
    const plan = new NodeRunner().plan(request('/x.cjs', ['clock', 'rng']));
    expect(plan.files.map((file) => file.path)).toEqual(['keel-node-preload.cjs']);
    expect(plan.env['NODE_OPTIONS']).toContain('--require ./keel-node-preload.cjs');
    expect(plan.env['TZ']).toBe('UTC');
    expect(plan.env['LC_ALL']).toBe('C.UTF-8');
    expect(plan.env['KEEL_CLOCK']).toBe('virtual');
    expect(plan.env['KEEL_RNG_SEED']).toBe(String(deriveSeed([process.execPath, '/x.cjs'])));
    expect(plan.sideChannel).toBe(true);
    expect(Object.keys(plan.armedInterceptors).sort()).toEqual(['clock', 'rng']);
  });

  it('deriveSeed is deterministic and non-zero', () => {
    expect(deriveSeed(['a', 'b'])).toBe(deriveSeed(['a', 'b']));
    expect(deriveSeed(['a', 'b'])).not.toBe(deriveSeed(['a', 'c']));
    expect(deriveSeed([''])).toBeGreaterThan(0);
  });

  it('side-channel parser tolerates garbage and unknown kinds', () => {
    const bytes = new TextEncoder().encode(
      'not json\n{"v":2,"kind":"future"}\n{"v":1,"kind":"net-call","sequence":1,"method":"GET","url":"u","status":200}\n{"v":1,"kind":"mystery"}\n',
    );
    const parsed = parseSideChannel(bytes);
    expect(parsed.netCalls).toHaveLength(1);
    expect(parsed.report).toBeNull();
  });
});

describe('node runner e2e — deterministic runtime', () => {
  it('Date.now, new Date, Math.random, and TZ are identical across runs', async () => {
    const file = await scriptFile(`
      console.log(JSON.stringify({
        now: Date.now(),
        again: Date.now(),
        wall: new Date().toISOString(),
        tzOffset: new Date().getTimezoneOffset(),
        rand: [Math.random(), Math.random(), Math.random()],
      }));
    `);
    const first = await run(request(file, ['clock', 'rng']));
    const second = await run(request(file, ['clock', 'rng']));
    expect(first.exit).toEqual({ kind: 'exited', code: 0 });
    const out1 = decoder.decode(first.stdout);
    expect(out1).toBe(decoder.decode(second.stdout));
    const parsed = JSON.parse(out1) as { now: number; again: number; tzOffset: number; wall: string };
    expect(parsed.now).toBe(946_684_800_000);
    expect(parsed.again).toBe(946_684_800_001); // per-call advance, deterministic
    expect(parsed.tzOffset).toBe(0);
    expect(parsed.wall.startsWith('2000-01-01T00:00:00')).toBe(true);
  }, 30_000);

  it('reports interceptors, module graph, and clean tamper state over the side channel', async () => {
    const file = await scriptFile(`require('node:path'); console.log('ok');`);
    const result = await run(request(file, ['clock', 'rng']));
    expect(result.sideChannel.report?.tampered).toBe(false);
    expect(result.sideChannel.report?.armed).toMatchObject({ clock: 'node-clock/1', rng: 'node-rng/1' });
    expect(result.sideChannel.report?.moduleGraph.some((entry) => entry.includes('probe.cjs'))).toBe(true);
  }, 30_000);

  it('detects tampering with the armed clock', async () => {
    const file = await scriptFile(`Date.now = () => 42; console.log('tampered');`);
    const result = await run(request(file, ['clock']));
    expect(result.sideChannel.report?.tampered).toBe(true);
    expect(result.sideChannel.report?.tamperFindings[0]).toContain('Date.now');
  }, 30_000);
});

describe('node runner e2e — network modes', () => {
  async function withServer(body: string, test: (url: string) => Promise<void>): Promise<void> {
    const server = createServer((_, response) => response.end(body));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      await test(`http://127.0.0.1:${String((server.address() as AddressInfo).port)}/api`);
    } finally {
      server.close();
    }
  }

  const FETCH_SCRIPT = `
    fetch(process.env.KEEL_TEST_URL).then(async (response) => {
      console.log(JSON.stringify({ status: response.status, body: await response.text() }));
    });
  `;

  it('record mode: real call, hashed net-call metadata on the side channel', async () => {
    await withServer('stable-payload', async (url) => {
      const file = await scriptFile(FETCH_SCRIPT);
      const result = await run(
        request(file, ['clock', 'rng', 'network'], {
          env: buildChildEnv({
            base: { ...process.env, KEEL_TEST_URL: url },
            allowlist: ['KEEL_TEST_URL'],
            overrides: {},
          }),
          interceptorConfig: { networkMode: 'record' },
        }),
      );
      expect(decoder.decode(result.stdout)).toContain('stable-payload');
      expect(result.sideChannel.netCalls).toHaveLength(1);
      expect(result.sideChannel.netCalls[0]).toMatchObject({ sequence: 0, method: 'GET', status: 200 });
      expect(result.sideChannel.netCalls[0]?.responseBodyHash).toMatch(/^[0-9a-f]{64}$/);
    });
  }, 30_000);

  it('stub mode serves recordings without a network; forbidden mode rejects', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'keel-node-stub-'));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const recordings = path.join(dir, 'recordings.json');
    await writeFile(
      recordings,
      JSON.stringify({
        'GET http://nowhere.invalid/api': { status: 200, bodyBase64: Buffer.from('stubbed!').toString('base64') },
      }),
    );
    const file = await scriptFile(FETCH_SCRIPT);
    const base = { ...process.env, KEEL_TEST_URL: 'http://nowhere.invalid/api' };
    const env = buildChildEnv({ base, allowlist: ['KEEL_TEST_URL'], overrides: {} });

    const stubbed = await run(
      request(file, ['network'], {
        env,
        interceptorConfig: { networkMode: 'stub', networkRecordingsPath: recordings },
      }),
    );
    expect(decoder.decode(stubbed.stdout)).toContain('stubbed!');

    const forbidden = await run(
      request(file, ['network'], { env, interceptorConfig: { networkMode: 'forbidden' } }),
    );
    expect(decoder.decode(forbidden.stderr)).toContain('network is forbidden');
    expect(forbidden.sideChannel.netCalls[0]?.blocked).toBe(true);
  }, 30_000);
});
