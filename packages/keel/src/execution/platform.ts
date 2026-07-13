/**
 * Platform detection and the deterministic execution fingerprint
 * (Doc 20 §2; C7: wall-clock, randomness, and unstable values never enter
 * canonical content).
 */

import { UserError } from '../shared/index.js';
import { contentHashOf } from '../model/index.js';
import type { ContentHash } from '../model/index.js';
import type { SupportedPlatform } from '@keel/runner-sdk';

export interface PlatformInfo {
  readonly os: SupportedPlatform;
  readonly arch: string;
  readonly runtimeName: 'node';
  readonly runtimeVersion: string;
}

const SUPPORTED: readonly string[] = ['linux', 'darwin', 'win32'];

export function detectPlatform(
  platform: string = process.platform,
  arch: string = process.arch,
  runtimeVersion: string = process.versions.node,
): PlatformInfo {
  if (!SUPPORTED.includes(platform)) {
    throw new UserError(`platform '${platform}' is not supported`, {
      code: 'KEEL_E_EXEC_UNSUPPORTED_PLATFORM',
      remediation: 'KEEL supports linux, macOS (darwin), and Windows (win32)',
      context: { platform },
    });
  }
  return {
    os: platform as SupportedPlatform,
    arch,
    runtimeName: 'node',
    runtimeVersion,
  };
}

/**
 * Deterministic identity of the execution *conditions* — a pure function of
 * platform, runner identity, and armed interceptor versions. Deliberately
 * excludes anything wall-clock, random, or per-run.
 */
export interface ExecutionConditions {
  readonly platform: PlatformInfo;
  readonly runnerId: string;
  readonly runnerVersion: string;
  readonly armedInterceptors: Readonly<Partial<Record<string, string>>>;
}

export function executionFingerprint(conditions: ExecutionConditions): ContentHash {
  return contentHashOf(conditions);
}
