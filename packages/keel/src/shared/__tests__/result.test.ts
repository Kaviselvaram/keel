import { describe, expect, it } from 'vitest';
import { err, isErr, isOk, ok } from '../result.js';
import type { Result } from '../result.js';

describe('Result', () => {
  it('ok carries the value and satisfies the guards', () => {
    const result: Result<number, string> = ok(7);
    expect(isOk(result)).toBe(true);
    expect(isErr(result)).toBe(false);
    if (isOk(result)) expect(result.value).toBe(7);
  });

  it('err carries the error and satisfies the guards', () => {
    const result: Result<number, string> = err('nope');
    expect(isErr(result)).toBe(true);
    expect(isOk(result)).toBe(false);
    if (isErr(result)) expect(result.error).toBe('nope');
  });
});
