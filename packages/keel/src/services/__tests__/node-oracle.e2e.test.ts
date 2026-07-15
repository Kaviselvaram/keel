/**
 * Doc 24 P7 acceptance, end to end through the unchanged oracle:
 *  1. a Date.now + Math.random + fetch fixture passes the determinism gate (×5),
 *  2. an added network call surfaces as `unrecorded-effect`,
 *  3. interceptor-version drift vs a P2-era environment yields stale-baseline.
 */

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { systemClock } from '../../shared/index.js';
import { noopLogger } from '../../observability/index.js';
import { loadConfig } from '../../config/index.js';
import {
  CommandRunner,
  ExecutionEngine,
  NodeRunner,
  RunnerRegistry,
} from '../../execution/index.js';
import { KeelStore } from '../../storage/index.js';
import { CaptureService } from '../capture-service.js';
import { CheckService } from '../check-service.js';
import { ReplayEngine } from '../../replay/index.js';
import { BUILTIN_RULES, RULESET_VERSION, normalizeExecution } from '../../capture/index.js';
import { toResolvedProbes } from '../probe-mapping.js';

const cleanups: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
});

const DEEP_SCRIPT = `
  fetch(process.env.KEEL_TEST_URL).then(async (response) => {
    console.log(JSON.stringify({
      at: Date.now(),
      lucky: Math.random(),
      api: { status: response.status, body: await response.text() },
    }));
  });
`;

async function harness() {
  const server = createServer((_, response) => response.end('deep-payload'));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/api`;

  const cwd = await mkdtemp(path.join(tmpdir(), 'keel-deep-'));
  const scriptFile = path.join(cwd, 'app.cjs');
  await writeFile(scriptFile, DEEP_SCRIPT);
  await writeFile(
    path.join(cwd, 'keel.config.jsonc'),
    JSON.stringify({
      version: 1,
      capture: { verificationCount: 5 }, // the determinism gate, CI strength
      probes: {
        app: {
          runner: 'node',
          command: process.execPath,
          args: [scriptFile],
          env: ['KEEL_TEST_URL'],
          interception: { clock: 'virtual', rng: 'seeded', network: 'record' },
        },
      },
    }),
  );
  const store = await KeelStore.open({ directory: path.join(cwd, '.keel'), logger: noopLogger });
  cleanups.push(async () => {
    await store.close().catch(() => undefined);
    server.close();
    await rm(cwd, { recursive: true, force: true, maxRetries: 5 }).catch(() => undefined);
  });
  const execution = new ExecutionEngine({
    registry: new RunnerRegistry([new CommandRunner(), new NodeRunner()]),
    logger: noopLogger,
  });
  const parentEnv = { ...process.env, KEEL_TEST_URL: url };
  const config = () => loadConfig({ cwd, env: {}, userFile: path.join(cwd, 'nope.json') });
  const shared = { execution, store, logger: noopLogger, clock: systemClock };
  return { cwd, scriptFile, store, execution, parentEnv, config, shared };
}

describe('node deep runner through the oracle (Doc 24 P7 acceptance)', () => {
  it('Date.now + Math.random + fetch passes the x5 determinism gate; check is clean; drift goes stale', async () => {
    const h = await harness();

    // 1. Determinism gate: 1 + 5 verification executions must be identical.
    const capture = await new CaptureService({ ...h.shared, keelVersion: '0.0.1-test' }).capture({
      config: h.config(),
      label: 'deep',
      git: { commit: 'aaaa111', dirty: false },
      parentEnv: h.parentEnv,
      signal: new AbortController().signal,
    });
    expect(capture.status).toBe('sealed');
    expect(capture.baseline.provenance.environment.interceptorVersions).toMatchObject({
      clock: 'node-clock/1',
      rng: 'node-rng/1',
      network: 'node-net/1',
    });

    // 2. Unchanged code: keel check is clean — proves CheckService derives the
    //    current interceptor versions correctly for node baselines.
    const clean = await new CheckService({ ...h.shared, treeDigest: async () => null }).check({
      config: h.config(),
      label: 'deep',
      gitCommit: 'aaaa111',
      parentEnv: h.parentEnv,
      signal: new AbortController().signal,
    });
    expect(clean.verdict.status).toBe('clean');

    // 3. The edit adds a SECOND network call → unrecorded-effect (net-call
    //    observations flow through the unchanged replay+diff).
    await writeFile(
      h.scriptFile,
      DEEP_SCRIPT.replace(
        'console.log(JSON.stringify({',
        'await fetch(process.env.KEEL_TEST_URL + "/extra"); console.log(JSON.stringify({',
      ),
    );
    const diverged = await new CheckService({ ...h.shared, treeDigest: async () => null }).check({
      config: h.config(),
      label: 'deep',
      gitCommit: 'aaaa111',
      parentEnv: h.parentEnv,
      signal: new AbortController().signal,
    });
    expect(diverged.verdict.status).toBe('diverged');
    expect(diverged.verdict.divergences.some((d) => d.kind === 'unrecorded-effect')).toBe(true);

    // 4. Capability negotiation vs a P2-era environment (no node interceptors):
    //    graceful stale-baseline naming interceptorVersions (strict, ADR-012).
    const baseline = capture.baseline;
    const p2Replay = await new ReplayEngine({
      execution: h.execution,
      snapshots: h.store.documents,
      logger: noopLogger,
      clock: systemClock,
    }).replay({
      baseline,
      probes: toResolvedProbes(h.config(), undefined),
      normalize: (result) => normalizeExecution(result, BUILTIN_RULES),
      currentConfigHash: h.config().configHash,
      currentRulesetVersion: RULESET_VERSION,
      currentInterceptorVersions: {}, // a Phase-2-era world
      gitCommit: 'aaaa111',
      parentEnv: h.parentEnv,
      signal: new AbortController().signal,
    });
    expect(p2Replay.status).toBe('stale-baseline');
    if (p2Replay.status !== 'stale-baseline') return;
    expect(p2Replay.findings.some((f) => f.field === 'interceptorVersions' && f.policy === 'strict')).toBe(true);
  }, 120_000);
});
