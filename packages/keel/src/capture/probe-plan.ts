/**
 * Probe planning: capture's own input type (consumer-owned per C22 — capture
 * may not import config) resolved into a model ProbeSpec (identity) and an
 * ExecutionRequest (mechanics).
 *
 * Interception → capability mapping: clock 'virtual' and rng 'seeded'
 * hard-require their interceptors (negotiation fails honestly on runners
 * without them); network 'record'/'stub' likewise. Network 'forbidden' is
 * DECLARATIVE on interceptor-less runners (the command runner cannot see
 * network traffic — Doc 05 §1); it becomes enforced on runners that offer
 * the network capability (Phase 7).
 */

import { hashBytes } from '../model/index.js';
import { createProbeSpec } from '../model/index.js';
import type { ProbeSpec } from '../model/index.js';
import type { ExecutionRequest } from '@keel/runner-sdk';
import type { InterceptorCapability } from '@keel/runner-sdk';

/** A probe as capture consumes it (structurally produced from ConfigSnapshot by services). */
export interface CaptureProbe {
  readonly name: string;
  readonly runner: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly stdinText: string | null;
  readonly envAllowlist: readonly string[];
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly maxFsEffectBytes: number;
  readonly interception: ProbeSpec['interception'];
  readonly hooks: { readonly setup?: string; readonly teardown?: string };
  readonly ignoreRules: readonly string[];
  readonly serial: boolean;
}

const encoder = new TextEncoder();
const HOOK_GRACE_MS = 500;

export function toProbeSpec(probe: CaptureProbe): ProbeSpec {
  return createProbeSpec({
    name: probe.name,
    runner: probe.runner,
    captureMode: 'process',
    invocation: {
      command: probe.command,
      args: probe.args,
      cwd: probe.cwd,
      stdin:
        probe.stdinText === null
          ? { kind: 'none' }
          : { kind: 'inline', contentHash: hashBytes(encoder.encode(probe.stdinText)) },
      envAllowlist: probe.envAllowlist,
    },
    interception: probe.interception,
    limits: {
      timeoutMs: probe.timeoutMs,
      maxOutputBytes: probe.maxOutputBytes,
      maxFsEffectBytes: probe.maxFsEffectBytes,
    },
    hooks: probe.hooks,
    ignoreRules: probe.ignoreRules,
    serial: probe.serial,
  });
}

export function requiredInterceptors(
  interception: ProbeSpec['interception'],
): readonly InterceptorCapability[] {
  const required: InterceptorCapability[] = [];
  if (interception.clock === 'virtual') required.push('clock');
  if (interception.rng === 'seeded') required.push('rng');
  if (interception.network === 'record' || interception.network === 'stub') required.push('network');
  return required;
}

export function toExecutionRequest(
  probe: CaptureProbe,
  env: Readonly<Record<string, string>>,
): ExecutionRequest {
  return {
    command: probe.command,
    args: probe.args,
    cwd: probe.cwd === '.' ? '' : probe.cwd,
    env,
    stdin:
      probe.stdinText === null
        ? { kind: 'none' }
        : { kind: 'bytes', bytes: encoder.encode(probe.stdinText) },
    limits: {
      timeoutMs: probe.timeoutMs,
      maxOutputBytes: probe.maxOutputBytes,
      maxFsEffectBytes: probe.maxFsEffectBytes,
      graceMs: HOOK_GRACE_MS,
    },
    mode: 'record',
    interceptors: requiredInterceptors(probe.interception),
    interceptorConfig: {},
  };
}

/** Hooks are shell command lines (fixture lifecycle, Doc 04) — wrapped per platform. */
export function hookExecutionRequest(
  hookCommand: string,
  probe: CaptureProbe,
  env: Readonly<Record<string, string>>,
  platformOs: string,
): ExecutionRequest {
  const shell: { command: string; args: readonly string[] } =
    platformOs === 'win32'
      ? { command: 'cmd.exe', args: ['/d', '/s', '/c', hookCommand] }
      : { command: '/bin/sh', args: ['-c', hookCommand] };
  return {
    command: shell.command,
    args: shell.args,
    cwd: '',
    env,
    stdin: { kind: 'none' },
    limits: {
      timeoutMs: probe.timeoutMs,
      maxOutputBytes: probe.maxOutputBytes,
      maxFsEffectBytes: probe.maxFsEffectBytes,
      graceMs: HOOK_GRACE_MS,
    },
    mode: 'record',
    interceptors: [],
    interceptorConfig: {},
  };
}
