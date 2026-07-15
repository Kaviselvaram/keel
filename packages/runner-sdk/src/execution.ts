/**
 * Execution request/plan/result types — the raw vocabulary runners speak
 * (Doc 20 §15). Deliberately distinct from the Behavior Model's normalized
 * Observation: these are *raw* facts; normalization is capture's job.
 */

import type { InterceptorCapability } from './capabilities.js';

export type RawStdin =
  | { readonly kind: 'none' }
  | { readonly kind: 'bytes'; readonly bytes: Uint8Array };

export interface ExecutionLimits {
  /** Wall-clock budget for the child. */
  readonly timeoutMs: number;
  /** Combined stdout+stderr cap, enforced live (Doc 24 P2). */
  readonly maxOutputBytes: number;
  /** Cap on bytes the fs-manifest scan will hash. */
  readonly maxFsEffectBytes: number;
  /** Grace between polite and forced termination. */
  readonly graceMs: number;
}

export type ExecutionMode = 'record' | 'replay';

/**
 * What the engine asks a runner to plan. Environment is the already-resolved
 * concrete child environment (allowlisting happens in the engine — runners
 * never see the parent environment).
 */
export interface ExecutionRequest {
  readonly command: string;
  readonly args: readonly string[];
  /** Workspace-relative POSIX path for the child's cwd ('' = workspace root). */
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly stdin: RawStdin;
  readonly limits: ExecutionLimits;
  readonly mode: ExecutionMode;
  /** Interceptors the caller requires armed; must be ⊆ runner capabilities. */
  readonly interceptors: readonly InterceptorCapability[];
  /** Per-interceptor settings (seed, virtual epoch, recording refs) — opaque to the SDK. */
  readonly interceptorConfig: Readonly<Record<string, string>>;
}

/** An auxiliary file the engine must materialize in the workspace before spawn. */
export interface PlannedFile {
  /** Workspace-relative POSIX path. */
  readonly path: string;
  readonly bytes: Uint8Array;
}

/**
 * The runner's output: how to spawn. Runners plan; only the engine spawns
 * (C23 holds for plugins too). Plans must be pure functions of the request —
 * the contract kit enforces this.
 */
export interface SpawnPlan {
  readonly argv: readonly [command: string, ...args: string[]];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly stdin: RawStdin;
  readonly files: readonly PlannedFile[];
  /** Interceptors this plan arms, with implementation versions (→ interceptor report). */
  readonly armedInterceptors: Readonly<Partial<Record<InterceptorCapability, string>>>;
  /**
   * Request an extra pipe (fd 3) for the side-channel protocol (Doc 05):
   * NDJSON messages from in-process interceptors to the engine. Additive in
   * protocol v1 — absent means no channel (Phase 2 planners unchanged).
   */
  readonly sideChannel?: boolean;
}

/** Raw process exit as the OS reported it. Interpretation (timeout? cancelled?) is the engine's. */
export interface RawExit {
  readonly code: number | null;
  readonly signal: string | null;
}

export type StreamName = 'stdout' | 'stderr';

/** Live output chunk delivered to the engine's streaming sink. */
export interface StreamChunk {
  readonly stream: StreamName;
  readonly bytes: Uint8Array;
}
