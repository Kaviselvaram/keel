/**
 * ReplayEngine (Doc 20 §4): reconstruct a sealed baseline's conditions and
 * produce fresh, comparable Snapshots.
 *
 * Contract lines honored structurally:
 *  - Blind to baseline OUTPUTS: the only field read from a baseline snapshot
 *    document is `probeSpecHash` (a condition, not an output). Observations
 *    are never touched here — comparison belongs to diff.
 *  - Normalization reuse without the forbidden replay→capture edge: the
 *    normalizer arrives as a consumer-owned port (C22/C27); callers bind
 *    capture's normalizeExecution with the active ruleset.
 *  - Hard provenance mismatch is a structured `stale-baseline` OUTCOME with
 *    per-field findings (ADR-012), not an error.
 *  - A probe that times out at replay is a behavioral FACT (diff will name
 *    it probe-failed) — the asymmetry with capture (where a timeout aborts)
 *    is deliberate: capture defines intent, replay observes reality.
 */

import { UserError } from '../shared/index.js';
import type { Clock } from '../shared/index.js';
import type { Logger } from '../observability/index.js';
import { createSnapshot, probeSpecHash } from '../model/index.js';
import type {
  Baseline,
  ContentHash,
  Observation,
  ProbeName,
  Snapshot,
  StalenessFinding,
} from '../model/index.js';
import {
  buildChildEnv,
  currentEnvironmentFingerprint,
  detectPlatform,
  hookExecutionRequest,
  toExecutionRequest,
  toProbeSpec,
} from '../execution/index.js';
import type { ExecutionEngine, ExecutionResult, ResolvedProbe } from '../execution/index.js';
import { DEFAULT_REPLAY_POLICY, evaluateProvenance } from './policy.js';
import type { ReplayPolicy } from './policy.js';

/* ── consumer-owned ports (C22) ──────────────────────────────────────── */

/** Read-side document access (KeelStore.documents satisfies this structurally). */
export interface SnapshotSourcePort {
  getDocument(hash: ContentHash): Promise<unknown>;
}

/** What replay needs back from normalization (capture's NormalizedExecution satisfies this). */
export interface ReplayNormalizedRun {
  readonly observations: readonly Observation[];
  readonly payloads: ReadonlyMap<ContentHash, Uint8Array>;
}

/** Normalization port — bound by the caller to capture's normalizer + active ruleset (Doc 20 §4). */
export type ReplayNormalizer = (result: ExecutionResult) => ReplayNormalizedRun;

/* ── request/outcome ─────────────────────────────────────────────────── */

export interface ReplayRequest {
  readonly baseline: Baseline;
  /** Current probes (from config via the caller); validated against baseline spec hashes. */
  readonly probes: readonly ResolvedProbe[];
  readonly normalize: ReplayNormalizer;
  readonly currentConfigHash: ContentHash;
  readonly currentRulesetVersion: string;
  /** Interceptor implementation versions currently available (from runner capabilities; {} for the command runner). */
  readonly currentInterceptorVersions?: Readonly<Record<string, string>>;
  readonly gitCommit: string | null;
  readonly parentEnv: Readonly<Record<string, string | undefined>>;
  readonly signal: AbortSignal;
  readonly policy?: ReplayPolicy;
  readonly onProgress?: (progress: { readonly phase: 'replay'; readonly probeName: ProbeName }) => void;
}

export interface ReplayedProbe {
  readonly snapshot: Snapshot;
  readonly payloads: ReadonlyMap<ContentHash, Uint8Array>;
}

export type ReplayOutcome =
  | {
      readonly status: 'replayed';
      readonly probes: Readonly<Record<ProbeName, ReplayedProbe>>;
      /** Warn-level provenance drift (e.g. gitCommit ancestor-drift) — facts for the verdict. */
      readonly warnings: readonly StalenessFinding[];
    }
  | {
      readonly status: 'stale-baseline';
      readonly findings: readonly StalenessFinding[];
    };

export interface ReplayEngineOptions {
  readonly execution: ExecutionEngine;
  readonly snapshots: SnapshotSourcePort;
  readonly logger: Logger;
  readonly clock: Clock;
}

export class ReplayEngine {
  private readonly options: ReplayEngineOptions;

  constructor(options: ReplayEngineOptions) {
    this.options = options;
  }

  async replay(request: ReplayRequest): Promise<ReplayOutcome> {
    const { baseline } = request;
    if (baseline.status !== 'sealed') {
      throw new UserError(`baseline '${baseline.id}' is ${baseline.status}, not sealed`, {
        code: 'KEEL_E_REPLAY_BASELINE_NOT_SEALED',
        remediation: 'replay requires a sealed baseline; re-capture first',
        context: { baselineId: baseline.id, status: baseline.status },
      });
    }

    // 1. Provenance policy (ADR-012) against current conditions.
    const evaluation = evaluateProvenance(
      baseline.provenance,
      {
        configHash: request.currentConfigHash,
        normalizationRulesetVersion: request.currentRulesetVersion,
        environment: currentEnvironmentFingerprint(request.currentInterceptorVersions ?? {}),
        gitCommit: request.gitCommit,
      },
      request.policy ?? DEFAULT_REPLAY_POLICY,
    );
    const findings: StalenessFinding[] = [...evaluation.findings];

    // 2. Probe-set and spec-hash validation (Doc 06 A4) — conditions only:
    //    probeSpecHash is the single field read from each snapshot document.
    const probesByName = new Map(request.probes.map((probe) => [probe.name, probe]));
    const toReplay: { probe: ResolvedProbe; specHash: ContentHash }[] = [];
    for (const [probeName, snapshotDocHash] of Object.entries(baseline.snapshots)) {
      const probe = probesByName.get(probeName);
      if (probe === undefined) {
        findings.push({
          field: `probe:${probeName}`,
          expected: 'declared in config',
          actual: 'missing',
          policy: 'strict',
        });
        continue;
      }
      const specHash = probeSpecHash(toProbeSpec(probe));
      const document = (await this.options.snapshots.getDocument(snapshotDocHash)) as {
        readonly probeSpecHash: ContentHash;
      };
      if (document.probeSpecHash !== specHash) {
        findings.push({
          field: `probeSpec:${probeName}`,
          expected: document.probeSpecHash,
          actual: specHash,
          policy: 'strict',
        });
        continue;
      }
      toReplay.push({ probe, specHash });
    }

    if (evaluation.fatal || findings.some((finding) => finding.policy === 'strict')) {
      this.options.logger.warn('replay.baseline.stale', {
        baselineId: baseline.id,
        findings: findings.map((finding) => finding.field),
      });
      return { status: 'stale-baseline', findings };
    }

    // 3. Re-execute under reconstructed conditions; normalize via the port.
    const platform = detectPlatform();
    const replayed: Record<ProbeName, ReplayedProbe> = {};
    for (const { probe, specHash } of toReplay) {
      this.assertNotCancelled(request.signal);
      request.onProgress?.({ phase: 'replay', probeName: probe.name });

      const result = await this.runProbeOnce(probe, request, platform.os);
      const normalized = request.normalize(result);
      replayed[probe.name] = {
        snapshot: createSnapshot({
          probeName: probe.name,
          probeSpecHash: specHash,
          normalizationRulesetVersion: request.currentRulesetVersion,
          observations: normalized.observations,
        }),
        payloads: normalized.payloads,
      };
    }

    this.options.logger.info('replay.run.finish', {
      baselineId: baseline.id,
      probes: toReplay.length,
      warnings: findings.length,
    });
    return { status: 'replayed', probes: replayed, warnings: findings };
  }

  private assertNotCancelled(signal: AbortSignal): void {
    if (signal.aborted) {
      throw new UserError('replay was cancelled', {
        code: 'KEEL_E_REPLAY_CANCELLED',
        remediation: 'rerun the check when ready',
      });
    }
  }

  /**
   * Hooks wrap replay executions exactly as they wrap capture executions
   * (same fixture lifecycle). Unlike capture, a timing-out MAIN execution is
   * data; only hook failure aborts (the fixture, not the code under
   * observation, is broken).
   */
  private async runProbeOnce(
    probe: ResolvedProbe,
    request: ReplayRequest,
    platformOs: string,
  ): Promise<ExecutionResult> {
    const env = buildChildEnv({ base: request.parentEnv, allowlist: probe.envAllowlist, overrides: {} });
    await this.runHook('setup', probe.hooks.setup, probe, env, platformOs, request.signal);
    const result = await this.options.execution.execute(
      { ...toExecutionRequest(probe, env), mode: 'replay' },
      { runnerId: probe.runner, signal: request.signal },
    );
    if (result.exit.kind === 'cancelled') this.assertNotCancelled(request.signal);
    await this.runHook('teardown', probe.hooks.teardown, probe, env, platformOs, request.signal);
    return result;
  }

  private async runHook(
    which: 'setup' | 'teardown',
    hookCommand: string | undefined,
    probe: ResolvedProbe,
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
      throw new UserError(`probe '${probe.name}' ${which} hook failed during replay`, {
        code: 'KEEL_E_REPLAY_HOOK_FAILED',
        remediation: `fix the ${which} hook command`,
        context: { probeName: probe.name, hook: which, exit: result.exit.kind },
      });
    }
  }
}
