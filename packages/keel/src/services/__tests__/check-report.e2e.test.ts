/**
 * CheckService + ReportService e2e: verdict assembly law (facts-first),
 * staleness/warning propagation, ADR-013 tree mutation, ADR-014 suppression
 * evaluation and lifecycle, error verdicts, and C12 re-projection.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { systemClock, ulid } from '../../shared/index.js';
import { noopLogger } from '../../observability/index.js';
import { loadConfig } from '../../config/index.js';
import { CommandRunner, ExecutionEngine, RunnerRegistry } from '../../execution/index.js';
import { KeelStore } from '../../storage/index.js';
import { createSuppression } from '../../model/index.js';
import { CaptureService } from '../capture-service.js';
import { CheckService } from '../check-service.js';
import type { TreeDigest } from '../check-service.js';
import { ReportService } from '../report-service.js';

const cleanups: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
});

async function harness(v1: string) {
  const cwd = await mkdtemp(path.join(tmpdir(), 'keel-check-'));
  const scriptFile = path.join(cwd, 'app.cjs');
  await writeFile(scriptFile, v1);
  await writeFile(
    path.join(cwd, 'keel.config.jsonc'),
    JSON.stringify({ version: 1, probes: { app: { command: process.execPath, args: [scriptFile] } } }),
  );
  const store = await KeelStore.open({ directory: path.join(cwd, '.keel'), logger: noopLogger });
  cleanups.push(async () => {
    await store.close().catch(() => undefined);
    await rm(cwd, { recursive: true, force: true, maxRetries: 5 }).catch(() => undefined);
  });
  const execution = new ExecutionEngine({ registry: new RunnerRegistry([new CommandRunner()]), logger: noopLogger });
  const config = () => loadConfig({ cwd, env: {}, userFile: path.join(cwd, 'nope.json') });
  const shared = { execution, store, logger: noopLogger, clock: systemClock };

  const captureService = new CaptureService({ ...shared, keelVersion: '0.0.1-test' });
  const capture = await captureService.capture({
    config: config(),
    label: 'main',
    git: { commit: 'aaaa111', dirty: false },
    parentEnv: process.env,
    signal: new AbortController().signal,
  });
  expect(capture.status).toBe('sealed');

  const check = (treeDigest: TreeDigest = async () => null, gitCommit: string | null = 'aaaa111') =>
    new CheckService({ ...shared, treeDigest }).check({
      config: config(),
      label: 'main',
      gitCommit,
      parentEnv: process.env,
      signal: new AbortController().signal,
    });
  const reports = new ReportService({ store, logger: noopLogger, clock: systemClock });
  return { cwd, scriptFile, store, config, check, reports, captureService };
}

const V1 = `console.log(JSON.stringify({v:1,other:'x'}))`;

describe('check + report', () => {
  it('clean check: persisted verdict, empty annotations, report re-projection (C11/C12)', async () => {
    const h = await harness(V1);
    const outcome = await h.check();
    expect(outcome.verdict.status).toBe('clean');
    expect(outcome.verdict.annotations).toEqual([]);
    expect(outcome.verdict.timing.classifyMs).toBe(0);
    // Replay snapshots persisted with refs: nothing dangles.
    expect((await h.store.gc()).dangling).toEqual([]);
    // Re-projection by id reproduces exactly what check returned.
    const reProjected = await h.reports.report(outcome.verdict.id);
    expect(reProjected.verdict).toEqual(outcome.verdict);
  }, 30_000);

  it('suppression evaluation: presentation filtered, facts intact, expiry transitions (ADR-014)', async () => {
    const h = await harness(V1);
    await writeFile(h.scriptFile, V1.replace('{v:1,', '{v:2,'));
    const first = await h.check();
    expect(first.verdict.status).toBe('diverged');
    const stableId = first.verdict.divergences[0]?.stableId ?? '';

    await h.store.suppressions.save(
      createSuppression({
        id: ulid(),
        target: { kind: 'stable-id', stableId },
        reason: 'accepted v2 price format',
        createdBy: 'cli',
        createdAtEpochMs: systemClock.epochMillis(),
      }),
    );
    const report = await h.reports.report(first.verdict.id);
    expect(report.divergences[0]?.suppressedBy).not.toBeNull();
    expect(report.unsuppressedCount).toBe(0);
    // Facts untouched (Doc 04): the verdict still records the divergence.
    expect(report.verdict.divergences).toHaveLength(1);

    // An already-expired suppression transitions and stops matching.
    await h.store.suppressions.save(
      createSuppression({
        id: ulid(),
        target: { kind: 'pattern', pattern: 'stream:stdout/*' },
        reason: 'temporary',
        createdBy: 'cli',
        createdAtEpochMs: 1_000,
        expiryEpochMs: 2_000,
      }),
    );
    await h.reports.report(first.verdict.id);
    expect(await h.store.suppressions.listByStatus('expired')).toHaveLength(1);
  }, 30_000);

  it('absorb-on-seal: re-capture absorbs stable-id suppressions (ADR-014)', async () => {
    const h = await harness(V1);
    await h.store.suppressions.save(
      createSuppression({
        id: ulid(),
        target: { kind: 'stable-id', stableId: 'a'.repeat(64) },
        reason: 'accepted',
        createdBy: 'cli',
        createdAtEpochMs: 1,
      }),
    );
    const recapture = await h.captureService.capture({
      config: h.config(),
      label: 'main',
      git: { commit: 'aaaa111', dirty: false },
      parentEnv: process.env,
      signal: new AbortController().signal,
    });
    expect(recapture.status).toBe('sealed');
    expect(await h.store.suppressions.listByStatus('active')).toHaveLength(0);
    expect(await h.store.suppressions.listByStatus('absorbed')).toHaveLength(1);
  }, 30_000);

  it('warn-level drift lands in verdict.staleness; strict mismatch yields stale-baseline verdict', async () => {
    const h = await harness(V1);
    const drifted = await h.check(async () => null, 'bbbb222');
    expect(drifted.verdict.status).toBe('clean');
    expect(drifted.verdict.staleness).toEqual([
      { field: 'gitCommit', expected: 'aaaa111', actual: 'bbbb222', policy: 'warn' },
    ]);

    await writeFile(
      path.join(h.cwd, 'keel.config.jsonc'),
      JSON.stringify({ version: 1, probes: { app: { command: process.execPath, args: [h.scriptFile, '--x'] } } }),
    );
    const stale = await h.check();
    expect(stale.verdict.status).toBe('stale-baseline');
    expect(stale.verdict.staleness.some((finding) => finding.policy === 'strict')).toBe(true);
    // Stale verdicts are persisted facts too.
    expect((await h.reports.report(stale.verdict.id)).verdict.status).toBe('stale-baseline');
  }, 30_000);

  it('tree mutation during the check flags the verdict (ADR-013)', async () => {
    const h = await harness(V1);
    let calls = 0;
    const mutatingDigest: TreeDigest = async () => `digest-${String(calls++)}`;
    const outcome = await h.check(mutatingDigest);
    expect(outcome.verdict.treeMutated).toBe(true);
    expect(outcome.verdict.status).toBe('clean'); // facts still reported
    const stable = await h.check(async () => 'same');
    expect(stable.verdict.treeMutated).toBe(false);
  }, 30_000);

  it('engine-level failure becomes a persisted error verdict, never a silent subset (Doc 03 §3.9)', async () => {
    const h = await harness(V1);
    // Same config, same provenance — but the environment lost its runner.
    const brokenService = new CheckService({
      execution: new ExecutionEngine({ registry: new RunnerRegistry([]), logger: noopLogger }),
      store: h.store,
      logger: noopLogger,
      clock: systemClock,
      treeDigest: async () => null,
    });
    const outcome = await brokenService.check({
      config: h.config(),
      label: 'main',
      gitCommit: 'aaaa111',
      parentEnv: process.env,
      signal: new AbortController().signal,
    });
    expect(outcome.verdict.status).toBe('error');
    expect(outcome.verdict.error?.scope).toBe('total');
    expect(outcome.verdict.error?.detail).toContain('command');
    // The error verdict is a persisted fact like any other.
    expect((await h.reports.report(outcome.verdict.id)).verdict.status).toBe('error');
  }, 30_000);
});
