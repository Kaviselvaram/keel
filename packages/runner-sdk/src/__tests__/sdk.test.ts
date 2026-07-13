import { describe, expect, it } from 'vitest';
import { negotiateCapabilities, PROTOCOL_VERSION, referenceRequest, runnerContractChecks } from '../index.js';
import type { Runner, RunnerCapabilities, SpawnPlan } from '../index.js';

const caps: RunnerCapabilities = {
  runnerId: 'fake',
  runnerVersion: '1.0.0',
  protocolVersion: PROTOCOL_VERSION,
  platforms: ['linux', 'darwin', 'win32'],
  interceptors: { clock: 'clock/1' },
};

/** A well-behaved reference runner used to self-test the kit. */
const goodRunner: Runner = {
  capabilities: () => caps,
  plan(request): SpawnPlan {
    for (const required of request.interceptors) {
      if (caps.interceptors[required] === undefined) {
        throw new Error(`missing interceptor ${required}`);
      }
    }
    return {
      argv: [request.command, ...request.args],
      cwd: request.cwd,
      env: request.env,
      stdin: request.stdin,
      files: [],
      armedInterceptors: request.interceptors.includes('clock') ? { clock: 'clock/1' } : {},
    };
  },
};

describe('capability negotiation', () => {
  it('succeeds when platform, protocol, and interceptors are satisfied', () => {
    expect(negotiateCapabilities(caps, ['clock'], 'linux', PROTOCOL_VERSION)).toEqual({ ok: true });
  });

  it('reports each failure dimension precisely', () => {
    const result = negotiateCapabilities(caps, ['rng'], 'linux', PROTOCOL_VERSION);
    expect(result).toEqual({
      ok: false,
      missingInterceptors: ['rng'],
      platformUnsupported: false,
      protocolMismatch: false,
    });
    const wrongEverything = negotiateCapabilities(
      { ...caps, platforms: ['linux'] },
      ['network'],
      'win32',
      PROTOCOL_VERSION + 1,
    );
    expect(wrongEverything.ok).toBe(false);
    if (!wrongEverything.ok) {
      expect(wrongEverything.platformUnsupported).toBe(true);
      expect(wrongEverything.protocolMismatch).toBe(true);
    }
  });
});

describe('runner contract kit (self-test)', () => {
  it('a conforming runner passes every check', () => {
    for (const check of runnerContractChecks(goodRunner)) {
      expect(() => check.run(), check.name).not.toThrow();
    }
  });

  it('catches a runner that silently ignores unsatisfiable interceptors', () => {
    const silentRunner: Runner = {
      capabilities: () => ({ ...caps, interceptors: {} }),
      plan: (request) => ({
        argv: [request.command, ...request.args],
        cwd: request.cwd,
        env: request.env,
        stdin: request.stdin,
        files: [],
        armedInterceptors: {},
      }),
    };
    const refusal = runnerContractChecks(silentRunner).find((check) =>
      check.name.includes('refused'),
    );
    expect(refusal).toBeDefined();
    expect(() => refusal?.run()).toThrowError(/contract violation/);
  });

  it('catches a non-deterministic planner', () => {
    let counter = 0;
    const flaky: Runner = {
      capabilities: () => caps,
      plan: (request) => ({
        argv: [request.command, String(counter++)],
        cwd: request.cwd,
        env: request.env,
        stdin: request.stdin,
        files: [],
        armedInterceptors: {},
      }),
    };
    const purity = runnerContractChecks(flaky).find((check) => check.name.includes('pure'));
    expect(() => purity?.run()).toThrowError(/contract violation/);
  });

  it('referenceRequest overrides merge', () => {
    expect(referenceRequest({ command: 'x' }).command).toBe('x');
    expect(referenceRequest().limits.timeoutMs).toBeGreaterThan(0);
  });
});
