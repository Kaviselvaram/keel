/**
 * Capture e2e: real config files, real execution engine (node children),
 * real store. This suite carries the Phase 4 acceptance criteria (Doc 24):
 * flaky rejection naming the flapping path, secrets scrubbed-and-flagged,
 * and the determinism gate (x20 verification on a fixture, every OS via the
 * CI matrix).
 */

import { mkdtemp, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { UserError, systemClock } from '../../shared/index.js';
import { noopLogger } from '../../observability/index.js';
import { loadConfig } from '../../config/index.js';
import { CommandRunner, ExecutionEngine, RunnerRegistry } from '../../execution/index.js';
import { KeelStore } from '../../storage/index.js';
import type { Snapshot } from '../../model/index.js';
import { CaptureService } from '../capture-service.js';
import type { CaptureProgress } from '../../capture/index.js';

const cleanups: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
});

const decoder = new TextDecoder();

interface Harness {
  readonly service: CaptureService;
  readonly store: KeelStore;
  readonly cwd: string;
  capture(options?: {
    probeFilter?: readonly string[];
    signal?: AbortSignal;
    onProgress?: (progress: CaptureProgress) => void;
    verificationCount?: number;
  }): ReturnType<CaptureService['capture']>;
}

async function harness(probes: Record<string, unknown>, extra: Record<string, unknown> = {}): Promise<Harness> {
  const cwd = await mkdtemp(path.join(tmpdir(), 'keel-capture-'));
  await writeFile(
    path.join(cwd, 'keel.config.jsonc'),
    JSON.stringify({ version: 1, probes, ...extra }),
  );
  const store = await KeelStore.open({ directory: path.join(cwd, '.keel'), logger: noopLogger });
  cleanups.push(async () => {
    await store.close().catch(() => undefined);
    await rm(cwd, { recursive: true, force: true, maxRetries: 5 }).catch(() => undefined);
  });
  const service = new CaptureService({
    execution: new ExecutionEngine({ registry: new RunnerRegistry([new CommandRunner()]), logger: noopLogger }),
    store,
    logger: noopLogger,
    clock: systemClock,
    keelVersion: '0.0.1-test',
  });
  return {
    service,
    store,
    cwd,
    capture: (options = {}) =>
      service.capture({
        config: loadConfig({
          cwd,
          env: {},
          userFile: path.join(cwd, 'no-user-config.json'),
          ...(options.verificationCount === undefined
            ? {}
            : { overrides: { verificationCount: options.verificationCount } }),
        }),
        label: 'main',
        git: { commit: null, dirty: true },
        parentEnv: process.env,
        signal: options.signal ?? new AbortController().signal,
        ...(options.probeFilter === undefined ? {} : { probeFilter: options.probeFilter }),
        ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
      }),
  };
}

const nodeProbe = (script: string, extra: Record<string, unknown> = {}) => ({
  command: process.execPath,
  args: ['-e', script],
  ...extra,
});

async function stdoutPayload(store: KeelStore, snapshotHash: string): Promise<string> {
  const snapshot = (await store.documents.getDocument(snapshotHash)) as Snapshot;
  const stream = snapshot.observations.find(
    (observation) => observation.kind === 'stream' && observation.stream === 'stdout',
  );
  if (stream?.kind !== 'stream') throw new Error('no stdout observation');
  return decoder.decode(await store.objects.get(stream.contentHash));
}

describe('capture pipeline e2e', () => {
  it('seals a deterministic probe: provenance, persistence, and full GC reachability', async () => {
    const h = await harness({
      api: nodeProbe(`console.log(JSON.stringify({greeting:'hello',count:42}))`),
    });
    const events: CaptureProgress[] = [];
    const result = await h.capture({ onProgress: (event) => events.push(event) });

    expect(result.status).toBe('sealed');
    const baseline = result.baseline;
    expect(baseline.provenance.configHash).toMatch(/^[0-9a-f]{64}$/);
    expect(baseline.provenance.normalizationRulesetVersion).toBe('rules/1');
    expect(baseline.provenance.environment.icuVersion.length).toBeGreaterThan(0);
    expect(baseline.sealedAtEpochMs).not.toBeNull();

    // Round-trips through the store; payload is canonical JSON.
    expect(await h.store.baselines.getById(baseline.id)).toEqual(baseline);
    const snapshotHash = h.store.baselines.snapshotHashes(baseline.id)['api'];
    expect(await stdoutPayload(h.store, snapshotHash ?? '')).toBe('{"count":42,"greeting":"hello"}');

    // Phase 3 checklist item: snapshot refs declared → nothing dangles.
    expect((await h.store.gc()).dangling).toEqual([]);

    // Progress: execute, then 2 verification passes, then seal.
    expect(events).toEqual([
      { phase: 'execute', probeName: 'api' },
      { phase: 'verify', probeName: 'api', iteration: 1 },
      { phase: 'verify', probeName: 'api', iteration: 2 },
      { phase: 'seal' },
    ]);
  });

  it('normalization makes volatile-but-stable output seal (timestamps scrubbed)', async () => {
    const h = await harness({
      timely: nodeProbe(`console.log(JSON.stringify({at:new Date().toISOString(),stable:1}))`),
    });
    const result = await h.capture();
    expect(result.status).toBe('sealed');
    const snapshotHash = h.store.baselines.snapshotHashes(result.baseline.id)['timely'];
    expect(await stdoutPayload(h.store, snapshotHash ?? '')).toBe(
      '{"at":"«keel:timestamp»","stable":1}',
    );
  });

  it('rejects a flaky probe naming the flapping path (Doc 24 P4 acceptance)', async () => {
    const h = await harness({
      flaky: nodeProbe(`console.log(JSON.stringify({rand:Math.random(),fixed:'x'}))`),
    });
    const result = await h.capture();
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') return;
    expect(result.rejection.probeName).toBe('flaky');
    expect(result.rejection.flappingPath).toBe('stream:stdout/json:$.rand');
    // The rejected baseline is persisted for diagnostics.
    const persisted = await h.store.baselines.getById(result.baseline.id);
    expect(persisted?.status).toBe('rejected');
    expect(persisted?.rejection?.flappingPath).toBe('stream:stdout/json:$.rand');
  });

  it('scrubs and flags secrets; the stored payload never contains the value', async () => {
    const h = await harness({
      leaky: nodeProbe(`console.log(JSON.stringify({key:'AKIA'+'ABCDEFGHIJKLMNOP',ok:true}))`),
    });
    const result = await h.capture();
    expect(result.status).toBe('sealed');
    expect(result.secretFindings['leaky']).toEqual(['aws-access-key']);
    const snapshotHash = h.store.baselines.snapshotHashes(result.baseline.id)['leaky'];
    const payload = await stdoutPayload(h.store, snapshotHash ?? '');
    expect(payload).toContain('«keel:secret»');
    expect(payload).not.toContain('AKIA');
  });

  it('runs hooks around every execution: setup before main, teardown after (Doc 04 fixture lifecycle)', async () => {
    const fixtureDir = await mkdtemp(path.join(tmpdir(), 'keel-hooks-'));
    cleanups.push(() => rm(fixtureDir, { recursive: true, force: true }));
    const hookScript = path.join(fixtureDir, 'hook.cjs');
    const marker = path.join(fixtureDir, 'marker.txt');
    await writeFile(
      hookScript,
      `const fs=require('fs');const marker=${JSON.stringify(marker)};
       const mode=process.argv[2];
       if(mode==='setup')fs.writeFileSync(marker,'ready');
       if(mode==='teardown')fs.unlinkSync(marker);`,
    );
    const h = await harness({
      fixtured: nodeProbe(
        `console.log(JSON.stringify({saw:require('fs').readFileSync(${JSON.stringify(marker)},'utf8')}))`,
        { hooks: { setup: `node ${hookScript} setup`, teardown: `node ${hookScript} teardown` } },
      ),
    });
    const result = await h.capture();
    expect(result.status).toBe('sealed');
    const snapshotHash = h.store.baselines.snapshotHashes(result.baseline.id)['fixtured'];
    expect(await stdoutPayload(h.store, snapshotHash ?? '')).toBe('{"saw":"ready"}');
    // Teardown ran last: the marker is gone.
    await expect(access(marker)).rejects.toThrow();
    // Hooks participate in probe identity (Doc 04): spec hash covers them.
    const doc = (await h.store.documents.getDocument(snapshotHash ?? '')) as Snapshot;
    expect(doc.probeSpecHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a failing hook aborts capture with the hook named', async () => {
    const h = await harness({
      broken: nodeProbe(`console.log('never runs')`, {
        hooks: { setup: `node -e process.exit(3)` },
      }),
    });
    await expect(h.capture()).rejects.toMatchObject({ code: 'KEEL_E_CAPTURE_HOOK_FAILED' });
  });

  it('probe execution failure (timeout) aborts capture with stderr context', async () => {
    const h = await harness({
      hang: nodeProbe(`console.error('warming up');setInterval(()=>{},1000)`, { timeoutMs: 400 }),
    });
    try {
      await h.capture();
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(UserError);
      expect((error as UserError).code).toBe('KEEL_E_CAPTURE_PROBE_FAILED');
      expect((error as UserError).remediation).toContain('warming up');
    }
  });

  it('validates probe filters, empty selections, and cancellation', async () => {
    const h = await harness({ real: nodeProbe(`console.log('1')`) });
    await expect(h.capture({ probeFilter: ['ghost'] })).rejects.toMatchObject({
      code: 'KEEL_E_CAPTURE_UNKNOWN_PROBE',
    });
    await expect(h.capture({ probeFilter: [] })).rejects.toMatchObject({
      code: 'KEEL_E_CAPTURE_NO_PROBES',
    });
    const aborted = new AbortController();
    aborted.abort();
    await expect(h.capture({ signal: aborted.signal })).rejects.toMatchObject({
      code: 'KEEL_E_CAPTURE_CANCELLED',
    });
  });

  it('determinism gate: x20 verification seals a stable fixture (Doc 24 P4 acceptance)', async () => {
    const h = await harness({
      stable: nodeProbe(`console.log(JSON.stringify({v:'stable-output',n:[1,2,3]}))`),
    });
    const result = await h.capture({ verificationCount: 20 });
    expect(result.status).toBe('sealed');
  }, 60_000);
});
