/**
 * CaptureEngine (Doc 20 §3): resolve → execute → normalize → persist →
 * verify → seal | reject.
 *
 * Storage access goes through consumer-owned ports (C22 — capture cannot
 * import storage/; the concrete KeelStore pieces satisfy these structurally
 * at the services layer). Probe execution failure aborts capture with the
 * probe's stderr attached; nondeterminism is a structured rejection naming
 * the flapping path (Doc 20 §3), never a runtime false positive later.
 */

import { UserError, invariant } from '../shared/index.js';
import type { Clock, UlidGenerator } from '../shared/index.js';
import type { Logger } from '../observability/index.js';
import {
  createCapturingBaseline,
  createSnapshot,
  probeSpecHash,
  rejectBaseline,
  sealBaseline,
  withSnapshotRef,
} from '../model/index.js';
import type {
  Baseline,
  BaselineRejection,
  ContentHash,
  EnvironmentFingerprint,
  Snapshot,
} from '../model/index.js';
import { buildChildEnv, detectPlatform } from '../execution/index.js';
import type { ExecutionEngine, ExecutionResult } from '../execution/index.js';
import { normalizeExecution } from './normalizer.js';
import type { NormalizedExecution } from './normalizer.js';
import type { NormalizationRule } from './rules.js';
import { RULESET_VERSION } from './rules.js';
import { hookExecutionRequest, toExecutionRequest, toProbeSpec } from './probe-plan.js';
import type { CaptureProbe } from './probe-plan.js';
import { findFlappingPath } from './verification.js';

/* ── consumer-owned storage ports (C22) ──────────────────────────────── */

export interface ObjectSinkPort {
  put(bytes: Uint8Array): Promise<{ readonly hash: ContentHash }>;
}

export interface DocumentSinkPort {
  putDocument(value: unknown, refs?: readonly ContentHash[]): Promise<ContentHash>;
}

export interface BaselineSinkPort {
  save(baseline: Baseline): Promise<void>;
}

/* ── request/result ──────────────────────────────────────────────────── */

export interface CaptureGitInfo {
  readonly commit: string | null;
  readonly dirty: boolean;
}

export type CaptureProgress =
  | { readonly phase: 'execute'; readonly probeName: string }
  | { readonly phase: 'verify'; readonly probeName: string; readonly iteration: number }
  | { readonly phase: 'seal' }
  | { readonly phase: 'reject'; readonly probeName: string };

export interface CaptureRequest {
  readonly label: string;
  readonly probes: readonly CaptureProbe[];
  readonly rules: readonly NormalizationRule[];
  readonly configHash: ContentHash;
  readonly keelVersion: string;
  readonly git: CaptureGitInfo;
  readonly parentEnv: Readonly<Record<string, string | undefined>>;
  readonly verificationCount: number;
  readonly signal: AbortSignal;
  readonly onProgress?: (progress: CaptureProgress) => void;
}

export type CaptureResult =
  | {
      readonly status: 'sealed';
      readonly baseline: Baseline;
      readonly secretFindings: Readonly<Record<string, readonly string[]>>;
    }
  | {
      readonly status: 'rejected';
      readonly baseline: Baseline;
      readonly rejection: BaselineRejection;
      readonly secretFindings: Readonly<Record<string, readonly string[]>>;
    };

export interface CaptureEngineOptions {
  readonly execution: ExecutionEngine;
  readonly objects: ObjectSinkPort;
  readonly documents: DocumentSinkPort;
  readonly baselines: BaselineSinkPort;
  readonly logger: Logger;
  readonly clock: Clock;
  readonly newId: UlidGenerator;
}

const stderrExcerpt = (result: ExecutionResult): string =>
  new TextDecoder().decode(result.stderr.subarray(0, 2048));

export class CaptureEngine {
  private readonly options: CaptureEngineOptions;

  constructor(options: CaptureEngineOptions) {
    this.options = options;
  }

  async capture(request: CaptureRequest): Promise<CaptureResult> {
    invariant(request.verificationCount >= 1, 'verificationCount must be >= 1', {});
    if (request.probes.length === 0) {
      throw new UserError('no probes to capture', {
        code: 'KEEL_E_CAPTURE_NO_PROBES',
        remediation: 'declare at least one probe in keel.config.jsonc',
      });
    }

    const armedUnion: Record<string, string> = {};
    const secretFindings: Record<string, readonly string[]> = {};

    let baseline = createCapturingBaseline({
      id: this.options.newId(),
      label: request.label,
      provenance: {
        gitCommit: request.git.commit,
        gitDirty: request.git.dirty,
        configHash: request.configHash,
        environment: this.environmentFingerprint(armedUnion),
        keelVersion: request.keelVersion,
        normalizationRulesetVersion: RULESET_VERSION,
      },
    });

    for (const probe of request.probes) {
      this.assertNotCancelled(request.signal);
      request.onProgress?.({ phase: 'execute', probeName: probe.name });

      const reference = await this.runProbeOnce(probe, request);
      const referenceNormalized = normalizeExecution(reference, request.rules);
      Object.assign(armedUnion, reference.armedInterceptors);
      secretFindings[probe.name] = referenceNormalized.secretFindings;
      if (referenceNormalized.secretFindings.length > 0) {
        this.options.logger.warn('capture.secrets.scrubbed', {
          probeName: probe.name,
          rules: referenceNormalized.secretFindings,
        });
      }

      const spec = toProbeSpec(probe);
      const snapshot = createSnapshot({
        probeName: probe.name,
        probeSpecHash: probeSpecHash(spec),
        normalizationRulesetVersion: RULESET_VERSION,
        observations: referenceNormalized.observations,
      });

      // Persist payloads + snapshot document with declared refs (Doc 02 §8;
      // refs keep the snapshot's stream payloads GC-reachable).
      const streamRefs: ContentHash[] = [];
      for (const [hash, bytes] of referenceNormalized.payloads) {
        await this.options.objects.put(bytes);
        streamRefs.push(hash);
      }
      const snapshotHash = await this.options.documents.putDocument(snapshot, streamRefs);
      baseline = withSnapshotRef(baseline, probe.name, snapshotHash);

      const rejection = await this.verifyProbe(probe, request, snapshot, referenceNormalized);
      if (rejection !== undefined) {
        request.onProgress?.({ phase: 'reject', probeName: probe.name });
        const rejected = rejectBaseline(baseline, rejection);
        await this.options.baselines.save(rejected);
        this.options.logger.warn('capture.baseline.rejected', {
          baselineId: rejected.id,
          probeName: rejection.probeName,
          flappingPath: rejection.flappingPath,
        });
        return { status: 'rejected', baseline: rejected, rejection, secretFindings };
      }
    }

    request.onProgress?.({ phase: 'seal' });
    // Fingerprint now reflects the union of interceptors actually armed.
    const sealed = sealBaseline(
      {
        ...baseline,
        provenance: {
          ...baseline.provenance,
          environment: this.environmentFingerprint(armedUnion),
        },
      },
      this.options.clock.epochMillis(),
    );
    await this.options.baselines.save(sealed);
    this.options.logger.info('capture.baseline.sealed', {
      baselineId: sealed.id,
      label: sealed.label,
      probes: request.probes.length,
    });
    return { status: 'sealed', baseline: sealed, secretFindings };
  }

  private environmentFingerprint(interceptorVersions: Record<string, string>): EnvironmentFingerprint {
    const platform = detectPlatform();
    return {
      os: platform.os,
      arch: platform.arch,
      runtimeName: platform.runtimeName,
      runtimeVersion: platform.runtimeVersion,
      icuVersion: process.versions.icu ?? 'none',
      interceptorVersions: { ...interceptorVersions },
    };
  }

  private assertNotCancelled(signal: AbortSignal): void {
    if (signal.aborted) {
      throw new UserError('capture was cancelled', {
        code: 'KEEL_E_CAPTURE_CANCELLED',
        remediation: 'rerun the capture when ready',
      });
    }
  }

  /** setup hook → main execution → teardown hook (hooks wrap EVERY run, including verification). */
  private async runProbeOnce(probe: CaptureProbe, request: CaptureRequest): Promise<ExecutionResult> {
    const platform = detectPlatform();
    const env = buildChildEnv({
      base: request.parentEnv,
      allowlist: probe.envAllowlist,
      overrides: {},
    });

    await this.runHook('setup', probe.hooks.setup, probe, env, platform.os, request.signal);

    const result = await this.options.execution.execute(toExecutionRequest(probe, env), {
      runnerId: probe.runner,
      signal: request.signal,
    });
    if (result.exit.kind === 'timeout' || result.exit.kind === 'output-limit') {
      throw new UserError(`probe '${probe.name}' failed to execute (${result.exit.kind})`, {
        code: 'KEEL_E_CAPTURE_PROBE_FAILED',
        remediation: `raise the probe's limits or fix the command; stderr: ${stderrExcerpt(result)}`,
        context: { probeName: probe.name, exit: result.exit.kind },
      });
    }
    if (result.exit.kind === 'cancelled') {
      this.assertNotCancelled(request.signal);
    }

    await this.runHook('teardown', probe.hooks.teardown, probe, env, platform.os, request.signal);
    return result;
  }

  private async runHook(
    which: 'setup' | 'teardown',
    hookCommand: string | undefined,
    probe: CaptureProbe,
    env: Readonly<Record<string, string>>,
    platformOs: string,
    signal: AbortSignal,
  ): Promise<void> {
    if (hookCommand === undefined) return;
    const result = await this.options.execution.execute(
      hookExecutionRequest(hookCommand, probe, env, platformOs),
      { runnerId: 'command', signal },
    );
    if (result.exit.kind !== 'exited' || result.exit.code !== 0) {
      throw new UserError(`probe '${probe.name}' ${which} hook failed`, {
        code: 'KEEL_E_CAPTURE_HOOK_FAILED',
        remediation: `fix the ${which} hook command; stderr: ${stderrExcerpt(result)}`,
        context: { probeName: probe.name, hook: which, exit: result.exit.kind },
      });
    }
  }

  /** N verification replays; returns a rejection when any run flaps (Doc 06 A1). */
  private async verifyProbe(
    probe: CaptureProbe,
    request: CaptureRequest,
    reference: Snapshot,
    referenceNormalized: NormalizedExecution,
  ): Promise<BaselineRejection | undefined> {
    for (let iteration = 1; iteration <= request.verificationCount; iteration++) {
      this.assertNotCancelled(request.signal);
      request.onProgress?.({ phase: 'verify', probeName: probe.name, iteration });

      const rerun = await this.runProbeOnce(probe, request);
      const rerunNormalized = normalizeExecution(rerun, request.rules);
      const rerunSnapshot = createSnapshot({
        probeName: probe.name,
        probeSpecHash: reference.probeSpecHash,
        normalizationRulesetVersion: RULESET_VERSION,
        observations: rerunNormalized.observations,
      });
      if (rerunSnapshot.contentHash !== reference.contentHash) {
        const flappingPath = findFlappingPath(reference, referenceNormalized.payloads, rerunNormalized);
        return {
          probeName: probe.name,
          flappingPath,
          reason: `verification replay ${String(iteration)}/${String(request.verificationCount)} diverged from the reference execution`,
        };
      }
    }
    return undefined;
  }
}
