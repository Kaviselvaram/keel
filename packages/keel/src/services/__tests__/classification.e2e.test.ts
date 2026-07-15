/**
 * Classification integration (Doc 24 P8): the real check pipeline with the
 * heuristic classifier wired. Proves annotations are additive (facts never
 * change, L1), persisted after facts (C11), attributed (C50), and that the
 * suppressed-stableId rule reflects a prior `keel suppress`. Excluded from
 * the AI-deletable CI run (it wires the real classifier).
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { systemClock } from '../../shared/index.js';
import { noopLogger } from '../../observability/index.js';
import { loadConfig } from '../../config/index.js';
import { CommandRunner, ExecutionEngine, RunnerRegistry } from '../../execution/index.js';
import { KeelStore } from '../../storage/index.js';
import { HeuristicClassifier } from '../../classify/index.js';
import { CaptureService } from '../capture-service.js';
import { CheckService } from '../check-service.js';
import type { CodeDiffSource } from '../classifier-port.js';
import { SuppressionService } from '../suppression-service.js';

const cleanups: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
});

async function harness(v1: string) {
  const cwd = await mkdtemp(path.join(tmpdir(), 'keel-classify-'));
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

  const capture = await new CaptureService({ ...shared, keelVersion: '0.0.1-test' }).capture({
    config: config(),
    label: 'main',
    git: { commit: 'aaaa111', dirty: false },
    parentEnv: process.env,
    signal: new AbortController().signal,
  });
  expect(capture.status).toBe('sealed');

  const check = (codeDiff?: CodeDiffSource, withClassifier = true) =>
    new CheckService({
      ...shared,
      treeDigest: async () => null,
      ...(withClassifier ? { classifier: new HeuristicClassifier() } : {}),
      ...(codeDiff === undefined ? {} : { codeDiff }),
    }).check({
      config: config(),
      label: 'main',
      gitCommit: 'aaaa111',
      parentEnv: process.env,
      signal: new AbortController().signal,
    });

  return { cwd, scriptFile, store, config, check, shared };
}

const V1 = `console.log('marker: alpha')`;

describe('classification integrated into check', () => {
  it('edited-value: the code diff literally introduced the new value → intended, additive', async () => {
    const h = await harness(V1);
    await writeFile(h.scriptFile, `console.log('marker: bravo')`);
    const codeDiff: CodeDiffSource = async () =>
      "diff --git a/app.cjs b/app.cjs\n--- a/app.cjs\n+++ b/app.cjs\n-console.log('marker: alpha')\n+console.log('marker: bravo')\n";

    const outcome = await h.check(codeDiff);
    expect(outcome.verdict.status).toBe('diverged');
    expect(outcome.verdict.divergences.length).toBeGreaterThan(0);
    // One annotation per divergence, all attributed.
    expect(outcome.verdict.annotations).toHaveLength(outcome.verdict.divergences.length);
    const streamAnnotation = outcome.verdict.annotations.find(
      (a) => a.attribution.tier === 'heuristic',
    );
    expect(streamAnnotation?.label).toBe('intended');
    expect(streamAnnotation?.attribution).toEqual({ tier: 'heuristic', ruleId: 'edited-value-overlap' });

    // Additive (L1): annotations never alter the fact set.
    const persisted = await h.store.verdicts.getById(outcome.verdict.id);
    expect(persisted?.annotations.length).toBe(outcome.verdict.annotations.length);
    expect(persisted?.divergences).toEqual(outcome.verdict.divergences);
    expect(persisted?.status).toBe('diverged');
  }, 30_000);

  it('no classifier wired → zero annotations (existing deterministic behavior preserved)', async () => {
    const h = await harness(V1);
    await writeFile(h.scriptFile, `console.log('marker: charlie')`);
    const outcome = await h.check(undefined, false);
    expect(outcome.verdict.status).toBe('diverged');
    expect(outcome.verdict.annotations).toEqual([]);
  }, 30_000);

  it('suppressed-stableId: a prior `keel suppress` makes the divergence read intended', async () => {
    const h = await harness(V1);
    await writeFile(h.scriptFile, `console.log('marker: delta')`);
    const first = await h.check();
    expect(first.verdict.status).toBe('diverged');
    const stableId = first.verdict.divergences[0]?.stableId ?? '';

    await new SuppressionService(h.store, systemClock).suppress({
      stableId,
      reason: 'accepted marker rename',
      createdBy: 'cli',
    });

    const second = await h.check();
    const annotation = second.verdict.annotations.find((a) => a.divergenceStableId === stableId);
    expect(annotation?.label).toBe('intended');
    expect(annotation?.attribution).toEqual({ tier: 'heuristic', ruleId: 'suppressed-stable-id' });
  }, 30_000);

  it('classifier failure degrades to no annotations — never fails the check (Doc 20 §6)', async () => {
    const h = await harness(V1);
    await writeFile(h.scriptFile, `console.log('marker: echo')`);
    const throwingDiff: CodeDiffSource = () => Promise.reject(new Error('git exploded'));
    const outcome = await h.check(throwingDiff);
    // The check still succeeds; facts are intact; annotations simply absent.
    expect(outcome.verdict.status).toBe('diverged');
    expect(outcome.verdict.annotations).toEqual([]);
    expect((await h.store.verdicts.getById(outcome.verdict.id))?.status).toBe('diverged');
  }, 30_000);
});
