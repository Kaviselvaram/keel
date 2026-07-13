/**
 * Golden regression protection (C70): the canonical byte output and hashes
 * recorded in canonical.golden.json are frozen. A failing case here means
 * the serializer's observable behavior changed — that invalidates every
 * existing baseline and requires a CANONICAL_FORM_VERSION bump plus an ADR,
 * never a fixture update in passing.
 *
 * Regenerate (deliberately!) with: node scripts/generate-canonical-golden.mjs --write
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalSerialize } from '../canonical.js';
import { contentHashOf } from '../hashing.js';

interface GoldenCase {
  readonly name: string;
  readonly input: unknown;
  readonly canonical: string;
  readonly sha256: string;
}

const fixture = JSON.parse(
  readFileSync(new URL('./golden/canonical.golden.json', import.meta.url), 'utf8'),
) as { readonly canonicalFormVersion: number; readonly cases: readonly GoldenCase[] };

describe('canonical serializer golden fixtures', () => {
  it('fixture targets the current canonical form version', () => {
    expect(fixture.canonicalFormVersion).toBe(1);
    expect(fixture.cases.length).toBeGreaterThanOrEqual(10);
  });

  for (const goldenCase of fixture.cases) {
    it(`bytes frozen: ${goldenCase.name}`, () => {
      expect(canonicalSerialize(goldenCase.input)).toBe(goldenCase.canonical);
      expect(contentHashOf(goldenCase.input)).toBe(goldenCase.sha256);
    });
  }
});
