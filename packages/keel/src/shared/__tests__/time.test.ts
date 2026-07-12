import { describe, expect, it } from 'vitest';
import { systemClock } from '../time.js';

describe('systemClock', () => {
  it('now() and epochMillis() agree', () => {
    const before = systemClock.epochMillis();
    const now = systemClock.now().getTime();
    const after = systemClock.epochMillis();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(after);
  });
});
