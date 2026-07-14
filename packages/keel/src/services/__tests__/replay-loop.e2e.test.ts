/**
 * The oracle's deterministic loop, end to end (Doc 24 P5 acceptance):
 * capture → replay → diff. Clean replay of unchanged code produces zero
 * divergences; a real code change produces exactly the divergence that
 * names it. Lives in services/__tests__ because wiring replay's ports to
 * capture's normalizer and the store is the composition seam's job —
 * replay itself never imports either.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { UserError, systemClock } from '../../shared/index.js';
import { noopLogger } from '../../observability/index.js';
import { loadConfig } from '../../config/index.js';
import type { ConfigSnapshot } from '../../config/index.js';
import { CommandRunner, ExecutionEngine, RunnerRegistry } from '../../execution/index.js';
import type { ResolvedProbe } from '../../execution/index.js';
import { KeelStore } from '../../storage/index.js';
import { BUILTIN_RULES, RULESET_VERSION, normalizeExecution } from '../../capture/index.js';
import { ReplayEngine } from '../../replay/index.js';
import type { ReplayRequest } from '../../replay/index.js';
import { diffSnapshots } from '../../diff/index.js';
import type { Baseline, ContentHash, Snapshot } from '../../model/index.js';
import { CaptureService } from '../capture-service.js';

const cleanups: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
});

function toResolvedProbes(config: ConfigSnapshot): ResolvedProbe[] {
  return Object.entries(config.probes).map(([name, probe]) => ({
    name,
    runner: probe.runner,
    command: probe.command,
    args: probe.args,
    cwd: probe.cwd,
    stdinText: probe.stdin,
    envAllowlist: probe.env,
    timeoutMs: probe.timeoutMs,
    maxOutputBytes: probe.maxOutputBytes,
    maxFsEffectBytes: probe.maxFsEffectBytes,
    interception: probe.interception,
    hooks: probe.hooks,
    ignoreRules: probe.ignoreRules,
    serial: probe.serial,
  }));
}

interface Loop {
  readonly store: KeelStore;
  readonly cwd: string;
  readonly scriptFile: string;
  config(): ConfigSnapshot;
  capture(): Promise<Baseline>;
  replay(baseline: Baseline, overrides?: Partial<ReplayRequest>): ReturnType<ReplayEngine['replay']>;
  baselineSnapshot(baseline: Baseline, probe: string): Promise<{ snapshot: Snapshot; payloads: Map<ContentHash, Uint8Array> }>;
}

async function loopHarness(scriptV1: string, probeExtras: Record<string, unknown> = {}): Promise<Loop> {
  const cwd = await mkdtemp(path.join(tmpdir(), 'keel-loop-'));
  const scriptFile = path.join(cwd, 'probe-script.cjs');
  await writeFile(scriptFile, scriptV1);
  await writeFile(
    path.join(cwd, 'keel.config.jsonc'),
    JSON.stringify({
      version: 1,
      probes: { app: { command: process.execPath, args: [scriptFile], ...probeExtras } },
    }),
  );
  const store = await KeelStore.open({ directory: path.join(cwd, '.keel'), logger: noopLogger });
  cleanups.push(async () => {
    await store.close().catch(() => undefined);
    await rm(cwd, { recursive: true, force: true, maxRetries: 5 }).catch(() => undefined);
  });
  const execution = new ExecutionEngine({ registry: new RunnerRegistry([new CommandRunner()]), logger: noopLogger });
  const captureService = new CaptureService({ execution, store, logger: noopLogger, clock: systemClock, keelVersion: '0.0.1-test' });
  const replayEngine = new ReplayEngine({ execution, snapshots: store.documents, logger: noopLogger, clock: systemClock });

  const config = (): ConfigSnapshot =>
    loadConfig({ cwd, env: {}, userFile: path.join(cwd, 'no-user.json') });

  return {
    store,
    cwd,
    scriptFile,
    config,
    async capture() {
      const result = await captureService.capture({
        config: config(),
        label: 'main',
        git: { commit: 'aaaa111', dirty: false },
        parentEnv: process.env,
        signal: new AbortController().signal,
      });
      expect(result.status).toBe('sealed');
      return result.baseline;
    },
    replay(baseline, overrides = {}) {
      const current = config();
      return replayEngine.replay({
        baseline,
        probes: toResolvedProbes(current),
        normalize: (result) => normalizeExecution(result, BUILTIN_RULES),
        currentConfigHash: current.configHash,
        currentRulesetVersion: RULESET_VERSION,
        gitCommit: 'aaaa111',
        parentEnv: process.env,
        signal: new AbortController().signal,
        ...overrides,
      });
    },
    async baselineSnapshot(baseline, probe) {
      const docHash = store.baselines.snapshotHashes(baseline.id)[probe];
      const snapshot = (await store.documents.getDocument(docHash ?? '')) as Snapshot;
      const payloads = new Map<ContentHash, Uint8Array>();
      for (const observation of snapshot.observations) {
        if (observation.kind === 'stream') {
          payloads.set(observation.contentHash, await store.objects.get(observation.contentHash));
        }
      }
      return { snapshot, payloads };
    },
  };
}

const V1 = `console.log(JSON.stringify({v:1,greeting:'hi',items:[{id:1,n:'a'},{id:2,n:'b'}]}))`;

describe('capture → replay → diff (the deterministic oracle loop)', () => {
  it('unchanged code replays to identical snapshots and zero divergences, repeatedly', async () => {
    const loop = await loopHarness(V1);
    const baseline = await loop.capture();
    const reference = await loop.baselineSnapshot(baseline, 'app');

    for (let round = 0; round < 3; round++) {
      const outcome = await loop.replay(baseline);
      expect(outcome.status).toBe('replayed');
      if (outcome.status !== 'replayed') return;
      expect(outcome.warnings).toEqual([]);
      const replayed = outcome.probes['app'];
      expect(replayed?.snapshot.contentHash).toBe(reference.snapshot.contentHash);
      const divergences = diffSnapshots(reference.snapshot, replayed?.snapshot as Snapshot, {
        payloads: new Map([...reference.payloads, ...(replayed?.payloads ?? new Map())]),
      });
      expect(divergences).toEqual([]);
    }
  }, 30_000);

  it('a real code change surfaces as exactly the divergence that names it', async () => {
    const loop = await loopHarness(V1);
    const baseline = await loop.capture();
    // The edit: same probe spec, different behavior.
    await writeFile(loop.scriptFile, V1.replace('{v:1,', '{v:2,'));

    const outcome = await loop.replay(baseline);
    expect(outcome.status).toBe('replayed');
    if (outcome.status !== 'replayed') return;
    const reference = await loop.baselineSnapshot(baseline, 'app');
    const replayed = outcome.probes['app'];
    const divergences = diffSnapshots(reference.snapshot, replayed?.snapshot as Snapshot, {
      payloads: new Map([...reference.payloads, ...(replayed?.payloads ?? new Map())]),
    });
    expect(divergences).toHaveLength(1);
    expect(divergences[0]?.kind).toBe('value-changed');
    expect(`${divergences[0]?.path.observation}:${divergences[0]?.path.locator}`).toBe(
      'stream:stdout/json:$.v',
    );
  }, 30_000);

  it('probe spec changes make the baseline stale, naming the probe (Doc 06 A4)', async () => {
    const loop = await loopHarness(V1);
    const baseline = await loop.capture();
    await writeFile(
      path.join(loop.cwd, 'keel.config.jsonc'),
      JSON.stringify({
        version: 1,
        probes: { app: { command: process.execPath, args: [loop.scriptFile, '--changed'] } },
      }),
    );
    const outcome = await loop.replay(baseline);
    expect(outcome.status).toBe('stale-baseline');
    if (outcome.status !== 'stale-baseline') return;
    const fields = outcome.findings.map((finding) => finding.field);
    expect(fields).toContain('configHash');
    expect(fields).toContain('probeSpec:app');
  }, 30_000);

  it('a probe missing from current config is a strict finding', async () => {
    const loop = await loopHarness(V1);
    const baseline = await loop.capture();
    const outcome = await loop.replay(baseline, { probes: [] });
    expect(outcome.status).toBe('stale-baseline');
    if (outcome.status !== 'stale-baseline') return;
    expect(outcome.findings.map((finding) => finding.field)).toContain('probe:app');
  }, 30_000);

  it('git commit drift is a warning (ancestor-drift), not staleness', async () => {
    const loop = await loopHarness(V1);
    const baseline = await loop.capture();
    const outcome = await loop.replay(baseline, { gitCommit: 'bbbb222' });
    expect(outcome.status).toBe('replayed');
    if (outcome.status !== 'replayed') return;
    expect(outcome.warnings).toEqual([
      { field: 'gitCommit', expected: 'aaaa111', actual: 'bbbb222', policy: 'warn' },
    ]);
  }, 30_000);

  it('a replay-time hang is DATA: probe-failed divergence, not an aborted check', async () => {
    const loop = await loopHarness(V1, { timeoutMs: 1_500 });
    const baseline = await loop.capture();
    await writeFile(loop.scriptFile, `setInterval(()=>{},1000)`); // the edit hangs the app
    const outcome = await loop.replay(baseline);
    expect(outcome.status).toBe('replayed');
    if (outcome.status !== 'replayed') return;
    const reference = await loop.baselineSnapshot(baseline, 'app');
    const replayed = outcome.probes['app'];
    const divergences = diffSnapshots(reference.snapshot, replayed?.snapshot as Snapshot, {
      payloads: new Map([...reference.payloads, ...(replayed?.payloads ?? new Map())]),
    });
    expect(divergences.some((d) => d.kind === 'probe-failed')).toBe(true);
  }, 30_000);

  it('replay refuses non-sealed baselines', async () => {
    const loop = await loopHarness(V1);
    const baseline = await loop.capture();
    const fake = { ...baseline, status: 'rejected' as const };
    await expect(loop.replay(fake as Baseline)).rejects.toBeInstanceOf(UserError);
  }, 30_000);
});
