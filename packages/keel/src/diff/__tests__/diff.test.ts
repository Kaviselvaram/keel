import { describe, expect, it } from 'vitest';
import { canonicalBytes, createSnapshot, hashBytes } from '../../model/index.js';
import type { ContentHash, Observation, Snapshot } from '../../model/index.js';
import { diffSnapshots } from '../engine.js';

const encoder = new TextEncoder();

interface Built {
  readonly snapshot: Snapshot;
  readonly payloads: Map<ContentHash, Uint8Array>;
}

function jsonSnapshot(value: unknown, extras: readonly Observation[] = [], exit: Observation & { kind: 'exit' } = { kind: 'exit', outcome: { kind: 'exited', code: 0 } }): Built {
  const stdout = canonicalBytes(value);
  const stderr = encoder.encode('');
  const payloads = new Map<ContentHash, Uint8Array>([
    [hashBytes(stdout), stdout],
    [hashBytes(stderr), stderr],
  ]);
  const observations: Observation[] = [
    exit,
    { kind: 'stream', stream: 'stdout', contentHash: hashBytes(stdout), byteLength: stdout.byteLength, interpretation: 'json' },
    { kind: 'stream', stream: 'stderr', contentHash: hashBytes(stderr), byteLength: 0, interpretation: 'text' },
    ...extras,
  ];
  return {
    snapshot: createSnapshot({
      probeName: 'probe-a',
      probeSpecHash: 'a'.repeat(64),
      normalizationRulesetVersion: 'rules/1',
      observations,
    }),
    payloads,
  };
}

function diffOf(a: Built, b: Built, ignoreRules: readonly string[] = []) {
  const payloads = new Map([...a.payloads, ...b.payloads]);
  return diffSnapshots(a.snapshot, b.snapshot, { payloads, ignoreRules });
}

const paths = (divergences: readonly { path: { observation: string; locator: string }; kind: string }[]) =>
  divergences.map((d) => `${d.kind}@${d.path.observation}:${d.path.locator}`);

describe('diff engine — comparators', () => {
  it('identical snapshots short-circuit to []', () => {
    const a = jsonSnapshot({ x: 1 });
    expect(diffOf(a, jsonSnapshot({ x: 1 }))).toEqual([]);
  });

  it('leaf value change → value-changed with both refs', () => {
    const divergences = diffOf(jsonSnapshot({ price: 10, name: 'a' }), jsonSnapshot({ price: 12, name: 'a' }));
    expect(paths(divergences)).toEqual(['value-changed@stream:stdout/json:$.price']);
    expect(divergences[0]?.baselineValueRef).not.toBeNull();
    expect(divergences[0]?.candidateValueRef).not.toBeNull();
    expect(divergences[0]?.stableId).toMatch(/^[0-9a-f]{64}$/);
  });

  it('object keys → entry-added / entry-removed with one-sided refs', () => {
    const divergences = diffOf(jsonSnapshot({ keep: 1, gone: 2 }), jsonSnapshot({ keep: 1, fresh: 3 }));
    expect(paths(divergences)).toEqual([
      'entry-added@stream:stdout/json:$.fresh',
      'entry-removed@stream:stdout/json:$.gone',
    ]);
    expect(divergences[0]?.baselineValueRef).toBeNull();
    expect(divergences[1]?.candidateValueRef).toBeNull();
  });

  it('type change → shape-changed; interpretation change → shape-changed at the stream', () => {
    expect(paths(diffOf(jsonSnapshot({ v: 1 }), jsonSnapshot({ v: 'one' })))).toEqual([
      'shape-changed@stream:stdout/json:$.v',
    ]);
    const textOut = encoder.encode('plain');
    const textBuilt: Built = {
      snapshot: createSnapshot({
        probeName: 'probe-a',
        probeSpecHash: 'a'.repeat(64),
        normalizationRulesetVersion: 'rules/1',
        observations: [
          { kind: 'exit', outcome: { kind: 'exited', code: 0 } },
          { kind: 'stream', stream: 'stdout', contentHash: hashBytes(textOut), byteLength: textOut.byteLength, interpretation: 'text' },
          { kind: 'stream', stream: 'stderr', contentHash: hashBytes(encoder.encode('')), byteLength: 0, interpretation: 'text' },
        ],
      }),
      payloads: new Map([[hashBytes(textOut), textOut], [hashBytes(encoder.encode('')), encoder.encode('')]]),
    };
    expect(paths(diffOf(jsonSnapshot({ v: 1 }), textBuilt))).toEqual([
      'shape-changed@stream:stdout/interpretation',
    ]);
  });

  it('identity-keyed arrays: pure reorder → order-changed; id removal → entry-removed[id=..]', () => {
    const a = jsonSnapshot({ items: [{ id: 1, v: 'a' }, { id: 2, v: 'b' }] });
    const reordered = jsonSnapshot({ items: [{ id: 2, v: 'b' }, { id: 1, v: 'a' }] });
    expect(paths(diffOf(a, reordered))).toEqual(['order-changed@stream:stdout/json:$.items']);
    const dropped = jsonSnapshot({ items: [{ id: 2, v: 'b' }] });
    expect(paths(diffOf(a, dropped))).toContain('entry-removed@stream:stdout/json:$.items[id=1]');
  });

  it('non-keyed arrays compare by index with tail add/remove', () => {
    expect(paths(diffOf(jsonSnapshot([1, 2]), jsonSnapshot([1, 3, 4])))).toEqual([
      'value-changed@stream:stdout/json:$[1]',
      'entry-added@stream:stdout/json:$[2]',
    ]);
  });

  it('exit changes: exit-changed normally, probe-failed when the candidate failed to run', () => {
    const ok = jsonSnapshot({ v: 1 });
    const exit3 = jsonSnapshot({ v: 1 }, [], { kind: 'exit', outcome: { kind: 'exited', code: 3 } });
    expect(paths(diffOf(ok, exit3))).toEqual(['exit-changed@exit:outcome']);
    const timedOut = jsonSnapshot({ v: 1 }, [], { kind: 'exit', outcome: { kind: 'timeout' } });
    expect(paths(diffOf(ok, timedOut))).toEqual(['probe-failed@exit:outcome']);
  });

  it('fs effects: added, removed, changed', () => {
    const base = jsonSnapshot({ v: 1 }, [
      { kind: 'fs-effect', path: 'kept.txt', effect: 'created', contentHash: 'b'.repeat(64) },
      { kind: 'fs-effect', path: 'lost.txt', effect: 'created', contentHash: 'c'.repeat(64) },
    ]);
    const cand = jsonSnapshot({ v: 1 }, [
      { kind: 'fs-effect', path: 'kept.txt', effect: 'created', contentHash: 'd'.repeat(64) },
      { kind: 'fs-effect', path: 'new.txt', effect: 'created', contentHash: 'e'.repeat(64) },
    ]);
    expect(paths(diffOf(base, cand))).toEqual([
      'effect-changed@fs-effect:kept.txt',
      'effect-removed@fs-effect:lost.txt',
      'effect-added@fs-effect:new.txt',
    ]);
  });

  it('ignore rules drop matching paths (v1 glob language)', () => {
    const a = jsonSnapshot({ meta: { at: 1 }, real: 'x' });
    const b = jsonSnapshot({ meta: { at: 2 }, real: 'y' });
    expect(paths(diffOf(a, b, ['stream:stdout/json:$.meta.*']))).toEqual([
      'value-changed@stream:stdout/json:$.real',
    ]);
  });

  it("keys shadowing Object.prototype members compare as own properties (property-suite regression)", () => {
    // fc counterexample: {} vs {"valueOf": null} — `in` would see the inherited method.
    expect(paths(diffOf(jsonSnapshot({}), jsonSnapshot({ valueOf: null })))).toEqual([
      'entry-added@stream:stdout/json:$.valueOf',
    ]);
    expect(paths(diffOf(jsonSnapshot({ toString: 1 }), jsonSnapshot({})))).toEqual([
      'entry-removed@stream:stdout/json:$.toString',
    ]);
  });

  it('invariants throw: probe mismatch and divergence ceiling', () => {
    const a = jsonSnapshot({ v: 1 });
    const other = createSnapshot({
      probeName: 'probe-b',
      probeSpecHash: 'a'.repeat(64),
      normalizationRulesetVersion: 'rules/1',
      observations: a.snapshot.observations,
    });
    expect(() => diffSnapshots(a.snapshot, other, { payloads: a.payloads })).toThrowError(/probe names differ/);

    const wide = jsonSnapshot(Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`k${String(i)}`, i])));
    const changed = jsonSnapshot(Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`k${String(i)}`, i + 1])));
    expect(() =>
      diffSnapshots(wide.snapshot, changed.snapshot, {
        payloads: new Map([...wide.payloads, ...changed.payloads]),
        maxDivergences: 3,
      }),
    ).toThrowError(/ceiling/);
  });
});
