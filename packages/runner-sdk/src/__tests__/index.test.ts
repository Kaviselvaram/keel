import { describe, expect, it } from 'vitest';
import { RUNNER_SDK_VERSION } from '../index.js';

describe('@keel/runner-sdk scaffold', () => {
  it('exposes a semver version', () => {
    expect(RUNNER_SDK_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
