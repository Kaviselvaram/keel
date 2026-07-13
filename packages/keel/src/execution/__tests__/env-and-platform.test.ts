import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { UserError } from '../../shared/index.js';
import { buildChildEnv } from '../env.js';
import { detectPlatform, executionFingerprint } from '../platform.js';

const nameArb = fc.stringMatching(/^[A-Z][A-Z0-9_]{0,10}$/);
const baseArb = fc.dictionary(nameArb, fc.string(), { maxKeys: 8 });

describe('buildChildEnv properties (C18)', () => {
  it('grants exactly the allowlist (plus documented implicit mechanics)', () => {
    fc.assert(
      fc.property(baseArb, fc.array(nameArb, { maxLength: 4 }), (base, allowlist) => {
        const child = buildChildEnv({ base, allowlist, overrides: {} });
        for (const key of Object.keys(child)) {
          const implicit = ['PATH', 'SYSTEMROOT', 'SYSTEMDRIVE', 'COMSPEC', 'WINDIR', 'TEMP', 'TMP'];
          expect(allowlist.includes(key) || implicit.includes(key)).toBe(true);
        }
        for (const name of allowlist) {
          if (base[name] !== undefined) expect(child[name]).toBe(base[name]);
        }
      }),
    );
  });

  it('a non-allowlisted secret never appears', () => {
    fc.assert(
      fc.property(baseArb, fc.string({ minLength: 1 }), (base, secret) => {
        const child = buildChildEnv({
          base: { ...base, KEEL_SECRET_X: secret },
          allowlist: Object.keys(base).filter((key) => key !== 'KEEL_SECRET_X'),
          overrides: {},
        });
        expect(child['KEEL_SECRET_X']).toBeUndefined();
      }),
    );
  });

  it('overrides always win', () => {
    const child = buildChildEnv({
      base: { PATH: '/real' },
      allowlist: [],
      overrides: { PATH: '/injected', NODE_OPTIONS: '--require shim' },
    });
    expect(child['PATH']).toBe('/injected');
    expect(child['NODE_OPTIONS']).toBe('--require shim');
  });

  it('resolves case-insensitively (Windows env semantics)', () => {
    const child = buildChildEnv({ base: { Path: 'C:\\bin' }, allowlist: [], overrides: {} });
    expect(child['PATH']).toBe('C:\\bin');
  });

  it('rejects malformed allowlist entries', () => {
    expect(() => buildChildEnv({ base: {}, allowlist: ['A=B'], overrides: {} })).toThrowError(UserError);
    expect(() => buildChildEnv({ base: {}, allowlist: [''], overrides: {} })).toThrowError(UserError);
  });
});

describe('platform + fingerprint', () => {
  it('detects the current platform and rejects unsupported ones', () => {
    expect(['linux', 'darwin', 'win32']).toContain(detectPlatform().os);
    expect(() => detectPlatform('sunos')).toThrowError(UserError);
  });

  it('fingerprint is a pure function of conditions — order-independent, timing-free', () => {
    const platform = detectPlatform('linux', 'x64', '22.0.0');
    const a = executionFingerprint({
      platform,
      runnerId: 'command',
      runnerVersion: '0.1.0',
      armedInterceptors: { clock: 'clock/1', rng: 'rng/1' },
    });
    const b = executionFingerprint({
      runnerVersion: '0.1.0',
      runnerId: 'command',
      platform,
      armedInterceptors: { rng: 'rng/1', clock: 'clock/1' },
    });
    expect(a).toBe(b);
    const c = executionFingerprint({
      platform,
      runnerId: 'command',
      runnerVersion: '0.2.0',
      armedInterceptors: {},
    });
    expect(c).not.toBe(a);
  });
});
