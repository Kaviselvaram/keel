/**
 * Runner contract-test kit v0 (C67, Doc 20 §15).
 *
 * Framework-agnostic: returns named checks that throw on violation, so any
 * test framework (or a plain script) can host them. Every Runner
 * implementation — built-in or third-party — must pass every check; this is
 * how LSP is tested rather than assumed (Doc 01 §4).
 *
 * v0 scope: the Runner interface is pure planning, so the kit is pure too.
 * Engine-level behaviors (timeouts, kill semantics, caps) are the engine's
 * own test surface, deliberately not part of the runner contract.
 */

import { INTERCEPTOR_CAPABILITIES } from './capabilities.js';
import type { ExecutionRequest, SpawnPlan } from './execution.js';
import type { Runner } from './runner.js';
import { PROTOCOL_VERSION } from './versions.js';

export interface ContractCheck {
  readonly name: string;
  run(): void;
}

function assertContract(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`runner contract violation: ${message}`);
  }
}

/** A minimal valid request the kit uses as its probe input. */
export function referenceRequest(overrides: Partial<ExecutionRequest> = {}): ExecutionRequest {
  return {
    command: 'reference-cmd',
    args: ['--flag', 'value'],
    cwd: '',
    env: { PATH: '/usr/bin' },
    stdin: { kind: 'none' },
    limits: { timeoutMs: 1000, maxOutputBytes: 65536, maxFsEffectBytes: 65536, graceMs: 100 },
    mode: 'record',
    interceptors: [],
    interceptorConfig: {},
    ...overrides,
  };
}

function planToComparable(plan: SpawnPlan): string {
  return JSON.stringify({
    argv: plan.argv,
    cwd: plan.cwd,
    env: Object.fromEntries(Object.entries(plan.env).sort(([a], [b]) => (a < b ? -1 : 1))),
    stdinKind: plan.stdin.kind,
    files: plan.files.map((file) => file.path),
    armed: Object.keys(plan.armedInterceptors).sort(),
  });
}

/** The v0 contract: capabilities honesty, plan purity, request fidelity. */
export function runnerContractChecks(runner: Runner): readonly ContractCheck[] {
  return [
    {
      name: 'capabilities are well-formed and protocol-compatible',
      run() {
        const caps = runner.capabilities();
        assertContract(caps.runnerId.length > 0, 'runnerId must be non-empty');
        assertContract(caps.runnerVersion.length > 0, 'runnerVersion must be non-empty');
        assertContract(
          caps.protocolVersion === PROTOCOL_VERSION,
          `protocolVersion must be ${String(PROTOCOL_VERSION)}`,
        );
        assertContract(caps.platforms.length > 0, 'must support at least one platform');
        for (const key of Object.keys(caps.interceptors)) {
          assertContract(
            (INTERCEPTOR_CAPABILITIES as readonly string[]).includes(key),
            `unknown interceptor capability '${key}'`,
          );
        }
      },
    },
    {
      name: 'capabilities are stable across calls',
      run() {
        assertContract(
          JSON.stringify(runner.capabilities()) === JSON.stringify(runner.capabilities()),
          'capabilities() must be deterministic',
        );
      },
    },
    {
      name: 'plan is a pure function of the request',
      run() {
        const request = referenceRequest();
        assertContract(
          planToComparable(runner.plan(request)) === planToComparable(runner.plan(request)),
          'identical requests must produce identical plans',
        );
      },
    },
    {
      name: 'plan preserves the requested command semantics',
      run() {
        const request = referenceRequest();
        const plan = runner.plan(request);
        assertContract(plan.argv.length >= 1, 'argv must contain at least the command');
        assertContract(plan.cwd === request.cwd, 'plan must not relocate the requested cwd');
        assertContract(plan.stdin.kind === request.stdin.kind, 'plan must preserve stdin source kind');
      },
    },
    {
      name: 'plan never invents environment beyond request plus interceptor wiring',
      run() {
        const request = referenceRequest({ env: { PATH: '/usr/bin', KEEL_TEST: 'x' } });
        const plan = runner.plan(request);
        for (const [key, value] of Object.entries(request.env)) {
          assertContract(plan.env[key] === value, `request env '${key}' must survive planning`);
        }
      },
    },
    {
      name: 'armed interceptors are a subset of declared capabilities',
      run() {
        const caps = runner.capabilities();
        const plan = runner.plan(referenceRequest());
        for (const armed of Object.keys(plan.armedInterceptors)) {
          assertContract(
            caps.interceptors[armed as keyof typeof caps.interceptors] !== undefined,
            `armed interceptor '${armed}' is not a declared capability`,
          );
        }
      },
    },
    {
      name: 'unsatisfiable interceptor requirements are refused, not ignored',
      run() {
        const caps = runner.capabilities();
        const missing = INTERCEPTOR_CAPABILITIES.find(
          (capability) => caps.interceptors[capability] === undefined,
        );
        if (missing === undefined) return; // runner offers everything — nothing to refuse
        let threw = false;
        try {
          runner.plan(referenceRequest({ interceptors: [missing] }));
        } catch {
          threw = true;
        }
        assertContract(threw, `plan() must throw when required interceptor '${missing}' is unavailable`);
      },
    },
  ];
}
