import { describe, expect, it } from 'vitest';
import { firstJsonDifference } from '../verification.js';

describe('firstJsonDifference (flapping-path naming, capture-internal)', () => {
  it('names the first differing path deterministically', () => {
    expect(firstJsonDifference({ a: 1 }, { a: 2 })).toBe('$.a');
    expect(firstJsonDifference({ a: { b: [1, 2] } }, { a: { b: [1, 3] } })).toBe('$.a.b[1]');
    expect(firstJsonDifference([1], [1, 2])).toBe('$[1]');
    expect(firstJsonDifference({ a: 1 }, { a: 1, b: 2 })).toBe('$.b');
    expect(firstJsonDifference('x', 5)).toBe('$');
    expect(firstJsonDifference(null, {})).toBe('$');
  });

  it('returns undefined for equal documents', () => {
    expect(firstJsonDifference({ a: [1, { b: 'x' }] }, { a: [1, { b: 'x' }] })).toBeUndefined();
  });
});
