import { afterEach, describe, expect, it } from 'vitest';
import { IntegrityError, InternalError, ulid } from '../../shared/index.js';
import {
  absorbSuppression,
  canonicalBytes,
  createAnnotation,
  createCapturingBaseline,
  createCheckRun,
  createDivergence,
  createSuppression,
  createVerdict,
  sealBaseline,
  withAnnotations,
  withSnapshotRef,
} from '../../model/index.js';
import type { Baseline, Verdict } from '../../model/index.js';
import type { KeelStore } from '../store.js';
import { cleanupStores, openTestStore } from './helpers.js';

afterEach(cleanupStores);

const HASH_CFG = 'c'.repeat(64);

const provenance = {
  gitCommit: null,
  gitDirty: true,
  configHash: HASH_CFG,
  environment: {
    os: 'linux',
    arch: 'x64',
    runtimeName: 'node',
    runtimeVersion: '22.0.0',
    icuVersion: '76.1',
    interceptorVersions: {},
  },
  keelVersion: '0.0.1',
  normalizationRulesetVersion: 'rules/1',
};

async function sealedBaseline(store: KeelStore, label = 'main'): Promise<Baseline> {
  const snapshotDoc = { fake: 'snapshot', at: ulid() };
  const { hash } = await store.objects.put(canonicalBytes(snapshotDoc));
  let baseline = createCapturingBaseline({ id: ulid(), label, provenance });
  baseline = withSnapshotRef(baseline, 'probe-a', hash);
  return sealBaseline(baseline, 1_720_000_000_000);
}

async function factsVerdict(store: KeelStore, baseline: Baseline): Promise<Verdict> {
  const replayDoc = await store.objects.put(canonicalBytes({ replay: ulid() }));
  const divergence = createDivergence({
    probeName: 'probe-a',
    path: { observation: 'stream', locator: 'stdout/json:$.x' },
    kind: 'value-changed',
    baselineValueRef: replayDoc.hash,
    candidateValueRef: replayDoc.hash,
  });
  return createVerdict({
    id: ulid(),
    checkRunId: ulid(),
    baselineId: baseline.id,
    status: 'diverged',
    divergences: [divergence],
    replaySnapshots: { 'probe-a': replayDoc.hash },
    codeDiffRef: null,
    treeMutated: false,
    staleness: [],
    error: null,
    timing: { replayMs: 1, diffMs: 1, classifyMs: 0, totalMs: 3 },
  });
}

describe('baseline repository', () => {
  it('persists sealed baselines and round-trips them structurally intact', async () => {
    const store = await openTestStore();
    const baseline = await sealedBaseline(store);
    await store.baselines.save(baseline);
    const loaded = await store.baselines.getById(baseline.id);
    expect(loaded).toEqual(baseline);
    expect(store.baselines.snapshotHashes(baseline.id)).toEqual(baseline.snapshots);
  });

  it('resolves the latest sealed baseline per label (ADR-012)', async () => {
    const store = await openTestStore();
    const older = await sealedBaseline(store, 'main');
    const newer = { ...(await sealedBaseline(store, 'main')), sealedAtEpochMs: 1_720_000_999_999 };
    await store.baselines.save(older);
    await store.baselines.save(newer as Baseline);
    expect((await store.baselines.latestSealedByLabel('main'))?.id).toBe(newer.id);
    expect(await store.baselines.latestSealedByLabel('feature-x')).toBeUndefined();
  });

  it('refuses non-terminal baselines (capture is atomic)', async () => {
    const store = await openTestStore();
    const capturing = createCapturingBaseline({ id: ulid(), label: 'main', provenance });
    await expect(store.baselines.save(capturing)).rejects.toBeInstanceOf(InternalError);
  });

  it('refuses baselines whose snapshots reference missing objects (reference validation)', async () => {
    const store = await openTestStore();
    let baseline = createCapturingBaseline({ id: ulid(), label: 'main', provenance });
    baseline = withSnapshotRef(baseline, 'probe-a', 'd'.repeat(64));
    await expect(store.baselines.save(sealBaseline(baseline, 1))).rejects.toBeInstanceOf(
      IntegrityError,
    );
  });

  it('is idempotent for identical content and conflicts loudly for same-id different-content', async () => {
    const store = await openTestStore();
    const baseline = await sealedBaseline(store);
    await store.baselines.save(baseline);
    await store.baselines.save(baseline); // idempotent retry
    const conflicting = { ...baseline, label: 'other' } as Baseline;
    await expect(store.baselines.save(conflicting)).rejects.toMatchObject({
      code: 'KEEL_E_STORE_ID_CONFLICT',
    });
  });

  it('lists lazily and removes rows only', async () => {
    const store = await openTestStore();
    const baseline = await sealedBaseline(store);
    await store.baselines.save(baseline);
    expect(store.baselines.list()).toHaveLength(1);
    expect(store.baselines.remove(baseline.id)).toBe(true);
    expect(await store.baselines.getById(baseline.id)).toBeUndefined();
    // Objects survive as GC-collectable garbage — never deleted inline.
    expect((await store.gc()).dangling.length).toBeGreaterThan(0);
  });
});

describe('verdict repository (facts before annotations, C11)', () => {
  it('persists facts, then attaches annotations one-shot', async () => {
    const store = await openTestStore();
    const baseline = await sealedBaseline(store);
    await store.baselines.save(baseline);
    const verdict = await factsVerdict(store, baseline);
    await store.verdicts.saveCheckRun(
      createCheckRun({ id: verdict.checkRunId, baselineId: baseline.id, startedAtEpochMs: 5 }),
    );
    await store.verdicts.saveVerdict(verdict);
    expect((await store.verdicts.getById(verdict.id))?.annotations).toEqual([]);

    const annotated = withAnnotations(verdict, [
      createAnnotation({
        divergenceStableId: verdict.divergences[0]?.stableId ?? '',
        label: 'collateral',
        confidence: 0.9,
        attribution: { tier: 'heuristic', ruleId: 'untouched-file' },
        rationale: 'diff never touched this path',
        evidencePacketHash: null,
      }),
    ]);
    await store.verdicts.attachAnnotations(annotated);
    expect((await store.verdicts.getById(verdict.id))?.annotations).toHaveLength(1);
    await expect(store.verdicts.attachAnnotations(annotated)).rejects.toMatchObject({
      code: 'KEEL_E_STORE_TRANSITION_CONFLICT',
    });
    expect(store.verdicts.listByBaseline(baseline.id)).toEqual([
      { id: verdict.id, baselineId: baseline.id, status: 'diverged', annotated: true },
    ]);
  });

  it('refuses annotated verdicts on the facts path', async () => {
    const store = await openTestStore();
    const baseline = await sealedBaseline(store);
    const verdict = await factsVerdict(store, baseline);
    const annotated = withAnnotations(verdict, [
      createAnnotation({
        divergenceStableId: verdict.divergences[0]?.stableId ?? '',
        label: 'uncertain',
        confidence: 0,
        attribution: { tier: 'none', reason: 'inference-unavailable' },
        rationale: 'n/a',
        evidencePacketHash: null,
      }),
    ]);
    await expect(store.verdicts.saveVerdict(annotated)).rejects.toBeInstanceOf(InternalError);
  });
});

describe('suppression repository (ADR-014)', () => {
  it('persists, transitions under guard, and makes concurrent transitions lose loudly', async () => {
    const store = await openTestStore();
    const suppression = createSuppression({
      id: ulid(),
      target: { kind: 'stable-id', stableId: 'a'.repeat(64) },
      reason: 'accepted format change',
      createdBy: 'cli',
      createdAtEpochMs: 100,
    });
    await store.suppressions.save(suppression);
    expect(await store.suppressions.listByStatus('active')).toHaveLength(1);

    const absorbed = absorbSuppression(suppression);
    await store.suppressions.transition(absorbed);
    expect((await store.suppressions.getById(suppression.id))?.status).toBe('absorbed');
    expect(await store.suppressions.listByStatus('active')).toHaveLength(0);
    expect(await store.suppressions.listByStatus('absorbed')).toHaveLength(1);

    // Second transition (e.g. a racing process) loses loudly, never silently.
    await expect(store.suppressions.transition(absorbed)).rejects.toMatchObject({
      code: 'KEEL_E_STORE_TRANSITION_CONFLICT',
    });
  });
});
