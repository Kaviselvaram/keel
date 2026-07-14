import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canonicalBytes, canonicalSerialize, compareDivergences, createSnapshot, hashBytes } from '../../model/index.js';
import type { ContentHash, Snapshot } from '../../model/index.js';
import { diffSnapshots } from '../engine.js';

function built(value: unknown): { snapshot: Snapshot; payloads: Map<ContentHash, Uint8Array> } {
  const stdout = canonicalBytes(value);
  return {
    snapshot: createSnapshot({
      probeName: 'p',
      probeSpecHash: 'a'.repeat(64),
      normalizationRulesetVersion: 'rules/1',
      observations: [
        { kind: 'exit', outcome: { kind: 'exited', code: 0 } },
        { kind: 'stream', stream: 'stdout', contentHash: hashBytes(stdout), byteLength: stdout.byteLength, interpretation: 'json' },
      ],
    }),
    payloads: new Map([[hashBytes(stdout), stdout]]),
  };
}

function run(a: unknown, b: unknown) {
  const A = built(a);
  const B = built(b);
  return diffSnapshots(A.snapshot, B.snapshot, {
    payloads: new Map([...A.payloads, ...B.payloads]),
    maxDivergences: 100_000,
  });
}

describe('diff engine — properties (Doc 24 P5 acceptance)', () => {
  it('diff(s, s) = [] for arbitrary JSON behavior', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        expect(run(value, structuredClone(value))).toEqual([]);
      }),
      { numRuns: 150 },
    );
  });

  it('is deterministic: identical inputs produce identical divergence lists', () => {
    fc.assert(
      fc.property(fc.jsonValue(), fc.jsonValue(), (a, b) => {
        expect(run(a, b)).toEqual(run(a, b));
      }),
      { numRuns: 100 },
    );
  });

  it('content inequality ⇔ at least one divergence', () => {
    fc.assert(
      fc.property(fc.jsonValue(), fc.jsonValue(), (a, b) => {
        const equal = canonicalSerialize(a) === canonicalSerialize(b);
        expect(run(a, b).length === 0).toBe(equal);
      }),
      { numRuns: 100 },
    );
  });

  it('added/removed flip under swap; changed paths are stable', () => {
    fc.assert(
      fc.property(fc.jsonValue(), fc.jsonValue(), (a, b) => {
        const forward = run(a, b);
        const backward = run(b, a);
        const key = (kind: string, locator: string): string => `${kind}|${locator}`;
        const backwardSet = new Set(backward.map((d) => key(d.kind, d.path.locator)));
        for (const divergence of forward) {
          const flipped =
            divergence.kind === 'entry-added'
              ? 'entry-removed'
              : divergence.kind === 'entry-removed'
                ? 'entry-added'
                : divergence.kind;
          expect(backwardSet.has(key(flipped, divergence.path.locator))).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('divergences are sorted and carry unique stable ids', () => {
    fc.assert(
      fc.property(fc.jsonValue(), fc.jsonValue(), (a, b) => {
        const divergences = run(a, b);
        const ids = divergences.map((d) => d.stableId);
        expect(new Set(ids).size).toBe(ids.length);
        // Sortedness is defined by the model's own comparator (Doc 06 B1).
        for (let index = 1; index < divergences.length; index++) {
          expect(
            compareDivergences(divergences[index - 1] as (typeof divergences)[number], divergences[index] as (typeof divergences)[number]),
          ).toBeLessThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });
});
