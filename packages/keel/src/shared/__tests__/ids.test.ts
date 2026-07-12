import { describe, expect, it } from 'vitest';
import { createUlidGenerator, isUlid, ulid } from '../ids.js';
import type { Clock } from '../time.js';

function fixedClock(epochMillis: number): Clock {
  return { now: () => new Date(epochMillis), epochMillis: () => epochMillis };
}

describe('ulid', () => {
  it('produces 26-character Crockford base32 ids', () => {
    for (let i = 0; i < 100; i++) {
      const id = ulid();
      expect(id).toHaveLength(26);
      expect(isUlid(id)).toBe(true);
    }
  });

  it('is unique across a burst', () => {
    const seen = new Set(Array.from({ length: 5000 }, () => ulid()));
    expect(seen.size).toBe(5000);
  });

  it('sorts by creation time across different milliseconds', () => {
    const earlier = createUlidGenerator(fixedClock(1_000_000))();
    const later = createUlidGenerator(fixedClock(2_000_000))();
    expect(earlier < later).toBe(true);
  });

  it('is monotonic within a single millisecond', () => {
    const generate = createUlidGenerator(fixedClock(1_720_000_000_000));
    let previous = generate();
    for (let i = 0; i < 1000; i++) {
      const next = generate();
      expect(next > previous).toBe(true);
      previous = next;
    }
  });

  it('encodes the same timestamp to the same 10-char prefix', () => {
    const generate = createUlidGenerator(fixedClock(1_720_000_000_000));
    expect(generate().slice(0, 10)).toBe(generate().slice(0, 10));
  });

  it('rejects malformed ids', () => {
    expect(isUlid('')).toBe(false);
    expect(isUlid('not-a-ulid-not-a-ulid-not!')).toBe(false);
    // I, L, O, U are excluded by Crockford base32.
    expect(isUlid('0123456789ILOU0123456789AB')).toBe(false);
  });
});
