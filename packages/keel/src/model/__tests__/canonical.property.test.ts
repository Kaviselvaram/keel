import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canonicalBytes, canonicalSerialize } from '../canonical.js';
import { CanonicalizationError } from '../errors.js';
import { contentHashOf } from '../hashing.js';

/** fc.jsonValue() generates exactly the JSON value space our serializer accepts. */
const jsonValue = (): fc.Arbitrary<unknown> => fc.jsonValue();

describe('canonical serialization — properties (L4)', () => {
  it('is deterministic: value and its structuredClone serialize identically', () => {
    fc.assert(
      fc.property(jsonValue(), (value) => {
        expect(canonicalSerialize(structuredClone(value))).toBe(canonicalSerialize(value));
      }),
    );
  });

  it('is idempotent: parse(canonical) re-serializes to the same bytes', () => {
    fc.assert(
      fc.property(jsonValue(), (value) => {
        const once = canonicalSerialize(value);
        expect(canonicalSerialize(JSON.parse(once))).toBe(once);
      }),
    );
  });

  it('object key insertion order never changes output', () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string(), jsonValue(), { maxKeys: 12 }),
        (record) => {
          const reversed: Record<string, unknown> = {};
          for (const key of Object.keys(record).reverse()) reversed[key] = record[key];
          let forward: string;
          try {
            forward = canonicalSerialize(record);
          } catch (error) {
            // NFC key collision must be rejected regardless of insertion order.
            expect(error).toBeInstanceOf(CanonicalizationError);
            expect(() => canonicalSerialize(reversed)).toThrowError(CanonicalizationError);
            return;
          }
          expect(canonicalSerialize(reversed)).toBe(forward);
        },
      ),
    );
  });

  it('unicode normalization is deterministic: NFD input canonicalizes like the original', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme' }), (text) => {
        expect(canonicalSerialize(text.normalize('NFD'))).toBe(canonicalSerialize(text.normalize('NFC')));
      }),
    );
  });

  it('repeated serialization produces byte-identical output', () => {
    fc.assert(
      fc.property(jsonValue(), (value) => {
        expect(canonicalBytes(value)).toEqual(canonicalBytes(value));
      }),
    );
  });

  it('output strings are already NFC (serialization of output is a fixed point)', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme' }), (text) => {
        const canonical = canonicalSerialize(text);
        expect(canonical.normalize('NFC')).toBe(canonical);
      }),
    );
  });
});

describe('content hashing — properties (C4, C33)', () => {
  it('hashes are stable across clones and repeat calls', () => {
    fc.assert(
      fc.property(jsonValue(), (value) => {
        const hash = contentHashOf(value);
        expect(contentHashOf(structuredClone(value))).toBe(hash);
        expect(contentHashOf(value)).toBe(hash);
        expect(hash).toMatch(/^[0-9a-f]{64}$/);
      }),
    );
  });

  it('hashes change exactly when canonical content changes', () => {
    fc.assert(
      fc.property(jsonValue(), jsonValue(), (a, b) => {
        const sameContent = canonicalSerialize(a) === canonicalSerialize(b);
        expect(contentHashOf(a) === contentHashOf(b)).toBe(sameContent);
      }),
    );
  });
});

describe('canonical serialization — rejections', () => {
  it('rejects non-finite numbers, undefined array elements, non-plain objects, bigint, and cycles', () => {
    expect(() => canonicalSerialize(Number.NaN)).toThrowError(CanonicalizationError);
    expect(() => canonicalSerialize(Number.POSITIVE_INFINITY)).toThrowError(CanonicalizationError);
    expect(() => canonicalSerialize([undefined])).toThrowError(CanonicalizationError);
    expect(() => canonicalSerialize(new Date(0))).toThrowError(CanonicalizationError);
    expect(() => canonicalSerialize(new Map())).toThrowError(CanonicalizationError);
    expect(() => canonicalSerialize(10n)).toThrowError(CanonicalizationError);
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    expect(() => canonicalSerialize(cyclic)).toThrowError(CanonicalizationError);
  });

  it('omits undefined object entries but rejects NFC-colliding keys', () => {
    expect(canonicalSerialize({ a: 1, b: undefined })).toBe('{"a":1}');
    // 'é' composed vs decomposed collide after NFC.
    expect(() => canonicalSerialize({ 'é': 1, 'é': 2 })).toThrowError(CanonicalizationError);
  });

  it('canonicalizes -0 to 0 and shares its hash', () => {
    expect(canonicalSerialize(-0)).toBe('0');
    expect(contentHashOf({ n: -0 })).toBe(contentHashOf({ n: 0 }));
  });
});
