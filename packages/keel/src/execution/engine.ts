/**
 * ExecutionEngine (Doc 20 §2): one controlled execution from request to raw
 * result. Orchestrates: negotiate → plan → workspace → spawn → manifest →
 * result. User-code failure is data, never an error (C42); the only throws
 * are engine faults (spawn), environment problems (runner missing,
 * negotiation), and caller errors (workspace escape).
 */

import { mkdir } from 'node:fs/promises';
import { EnvironmentError, invariant } from '../shared/index.js';
import type { Clock } from '../shared/index.js';
import { systemClock } from '../shared/index.js';
import type { Logger } from '../observability/index.js';
import type { ContentHash } from '../model/index.js';
import type { ExecutionRequest, StreamChunk } from '@keel/runner-sdk';
import { negotiateCapabilities, PROTOCOL_VERSION } from '@keel/runner-sdk';
import { detectPlatform, executionFingerprint } from './platform.js';
import type { ExecutionConditions, PlatformInfo } from './platform.js';
import { diffManifests, FsBudgetExceeded, scanManifest } from './manifest.js';
import type { RawFsEvent } from './manifest.js';
import { controlledSpawn } from './process-control.js';
import { EMPTY_SIDE_CHANNEL, parseSideChannel } from './side-channel.js';
import type { SideChannelData } from './side-channel.js';
import type { RunnerRegistry } from './registry.js';
import { createWorkspace } from './workspace.js';

export type ExitStatus =
  | { readonly kind: 'exited'; readonly code: number }
  | { readonly kind: 'signaled'; readonly signal: string }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'output-limit' };

export interface ExecutionResult {
  readonly exit: ExitStatus;
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
  readonly fsEvents: readonly RawFsEvent[];
  /** True when effects exceeded limits.maxFsEffectBytes (exit is then 'output-limit'). */
  readonly fsBudgetExceeded: boolean;
  /** Deterministic conditions + fingerprint — no wall-clock, no randomness (C7). */
  readonly conditions: ExecutionConditions;
  readonly fingerprint: ContentHash;
  readonly armedInterceptors: Readonly<Partial<Record<string, string>>>;
  /** Wall-clock metadata — recorded, never part of the fingerprint. */
  readonly startedAtEpochMs: number;
  readonly durationMs: number;
  /** Side-channel results (Doc 05, additive): net calls + interceptor runtime report. */
  readonly sideChannel: SideChannelData;
}

export interface ExecuteOptions {
  readonly runnerId: string;
  readonly signal: AbortSignal;
  /** Live output streaming (progress surfaces); buffering and caps are engine-internal. */
  readonly onChunk?: (chunk: StreamChunk) => void;
  /** Workspace parent directory override (tests). */
  readonly workspaceBaseDir?: string;
}

export interface ExecutionEngineOptions {
  readonly registry: RunnerRegistry;
  readonly logger: Logger;
  readonly clock?: Clock;
  readonly platform?: PlatformInfo;
}

export class ExecutionEngine {
  private readonly registry: RunnerRegistry;
  private readonly logger: Logger;
  private readonly clock: Clock;
  private readonly platform: PlatformInfo;

  constructor(options: ExecutionEngineOptions) {
    this.registry = options.registry;
    this.logger = options.logger;
    this.clock = options.clock ?? systemClock;
    this.platform = options.platform ?? detectPlatform();
  }

  /** Capability reporting (Doc 20 §2): registry discovery surfaced for provenance policy. */
  capabilitiesOf(runnerId: string) {
    return this.registry.get(runnerId).capabilities();
  }

  async execute(request: ExecutionRequest, options: ExecuteOptions): Promise<ExecutionResult> {
    const runner = this.registry.get(options.runnerId);
    const capabilities = runner.capabilities();

    const negotiation = negotiateCapabilities(
      capabilities,
      request.interceptors,
      this.platform.os,
      PROTOCOL_VERSION,
    );
    if (!negotiation.ok) {
      throw new EnvironmentError(`runner '${options.runnerId}' cannot satisfy this execution`, {
        code: 'KEEL_E_EXEC_NEGOTIATION_FAILED',
        context: {
          runnerId: options.runnerId,
          missingInterceptors: negotiation.missingInterceptors,
          platformUnsupported: negotiation.platformUnsupported,
          protocolMismatch: negotiation.protocolMismatch,
        },
      });
    }

    const conditions: ExecutionConditions = {
      platform: this.platform,
      runnerId: capabilities.runnerId,
      runnerVersion: capabilities.runnerVersion,
      armedInterceptors: {},
    };

    const startedAtEpochMs = this.clock.epochMillis();
    this.logger.info('execution.run.start', {
      runnerId: options.runnerId,
      command: request.command,
      mode: request.mode,
    });

    if (options.signal.aborted) {
      // Cancelled before spawn: data, not an error (C42) — nothing ran.
      this.logger.info('execution.run.finish', { exit: 'cancelled', preSpawn: true });
      return {
        exit: { kind: 'cancelled' },
        stdout: new Uint8Array(),
        stderr: new Uint8Array(),
        stdoutTruncated: false,
        stderrTruncated: false,
        fsEvents: [],
        fsBudgetExceeded: false,
        conditions,
        fingerprint: executionFingerprint(conditions),
        armedInterceptors: {},
        startedAtEpochMs,
        durationMs: 0,
        sideChannel: EMPTY_SIDE_CHANNEL,
      };
    }

    const plan = (() => {
      try {
        return runner.plan(request);
      } catch (cause) {
        throw new EnvironmentError(`runner '${options.runnerId}' rejected the execution plan`, {
          code: 'KEEL_E_EXEC_PLAN_REJECTED',
          context: { runnerId: options.runnerId },
          cause,
        });
      }
    })();

    const armedConditions: ExecutionConditions = {
      ...conditions,
      armedInterceptors: plan.armedInterceptors,
    };

    const workspace = await createWorkspace({
      logger: this.logger,
      ...(options.workspaceBaseDir === undefined ? {} : { baseDir: options.workspaceBaseDir }),
    });
    try {
      await workspace.materialize(plan.files);
      const childCwd = workspace.resolve(plan.cwd);
      await mkdir(childCwd, { recursive: true });

      const before = await scanManifest(workspace.root, Number.MAX_SAFE_INTEGER);
      const preexistingBytes = [...before.values()].reduce((sum, entry) => sum + entry.size, 0);

      const controlled = await controlledSpawn({
        argv: plan.argv,
        cwd: childCwd,
        env: plan.env,
        stdin: plan.stdin,
        timeoutMs: request.limits.timeoutMs,
        graceMs: request.limits.graceMs,
        maxOutputBytes: request.limits.maxOutputBytes,
        signal: options.signal,
        logger: this.logger,
        ...(options.onChunk === undefined ? {} : { onChunk: options.onChunk }),
        ...(plan.sideChannel === true ? { sideChannel: true } : {}),
      });

      let fsEvents: readonly RawFsEvent[] = [];
      let fsBudgetExceeded = false;
      try {
        const after = await scanManifest(
          workspace.root,
          request.limits.maxFsEffectBytes + preexistingBytes,
        );
        fsEvents = diffManifests(before, after);
      } catch (error) {
        if (!(error instanceof FsBudgetExceeded)) throw error;
        fsBudgetExceeded = true;
        this.logger.warn('execution.manifest.budget-exceeded', { atPath: error.atPath });
      }

      let exit: ExitStatus;
      if (fsBudgetExceeded || controlled.killCause === 'output-limit') {
        exit = { kind: 'output-limit' };
      } else if (controlled.killCause !== undefined) {
        exit = { kind: controlled.killCause };
      } else if (controlled.signal !== null) {
        exit = { kind: 'signaled', signal: controlled.signal };
      } else {
        invariant(controlled.code !== null, 'process closed with neither code nor signal');
        exit = { kind: 'exited', code: controlled.code };
      }

      const durationMs = this.clock.epochMillis() - startedAtEpochMs;
      this.logger.info('execution.run.finish', {
        exit: exit.kind,
        durationMs,
        stdoutBytes: controlled.stdout.byteLength,
        stderrBytes: controlled.stderr.byteLength,
        fsEvents: fsEvents.length,
      });

      return {
        exit,
        stdout: controlled.stdout,
        stderr: controlled.stderr,
        stdoutTruncated: controlled.stdoutTruncated,
        stderrTruncated: controlled.stderrTruncated,
        fsEvents,
        fsBudgetExceeded,
        conditions: armedConditions,
        fingerprint: executionFingerprint(armedConditions),
        armedInterceptors: plan.armedInterceptors,
        startedAtEpochMs,
        durationMs,
        sideChannel:
          plan.sideChannel === true ? parseSideChannel(controlled.sideChannel) : EMPTY_SIDE_CHANNEL,
      };
    } finally {
      await workspace.cleanup();
    }
  }
}
