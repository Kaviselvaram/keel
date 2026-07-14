/**
 * CheckService (Doc 20 §11, Doc 02 §3): the flagship use case — replay a
 * baseline, diff the results, assemble and persist the Verdict.
 *
 * Law-bearing sequence (C11/C12): the verdict is a complete, persisted fact
 * document before this method returns; every adapter response is a
 * projection of it. Classification (Phases 8/9) later appends annotations —
 * nothing here.
 *
 * Tree mutation (ADR-013): a digest is taken at start via the injected
 * TreeDigest port (composition-root concern) and re-taken at verdict
 * assembly; mismatch flags the verdict `treeMutated` — facts still reported.
 */

import { EnvironmentError, ExecutionFault, UserError, ulid } from '../shared/index.js';
import type { Clock } from '../shared/index.js';
import type { Logger } from '../observability/index.js';
import type { ConfigSnapshot } from '../config/index.js';
import {
  compareDivergences,
  createCheckRun,
  createVerdict,
} from '../model/index.js';
import type {
  Baseline,
  ContentHash,
  Divergence,
  ProbeName,
  Snapshot,
  StalenessFinding,
  Verdict,
  VerdictStatus,
} from '../model/index.js';
import { normalizeExecution, RULESET_VERSION } from '../capture/index.js';
import { ReplayEngine } from '../replay/index.js';
import { diffSnapshots } from '../diff/index.js';
import type { ExecutionEngine } from '../execution/index.js';
import type { KeelStore } from '../storage/index.js';
import { compileRules, toResolvedProbes } from './probe-mapping.js';

/** ADR-013 port: digest of the working tree, null when not applicable (not a git repo). */
export type TreeDigest = () => Promise<string | null>;

export interface CheckServiceOptions {
  readonly execution: ExecutionEngine;
  readonly store: KeelStore;
  readonly logger: Logger;
  readonly clock: Clock;
  readonly treeDigest: TreeDigest;
}

export interface CheckCommand {
  readonly config: ConfigSnapshot;
  /** Explicit baseline id, or resolution by label (ADR-012: latest sealed for the label). */
  readonly baselineId?: string;
  readonly label: string;
  readonly gitCommit: string | null;
  readonly parentEnv: Readonly<Record<string, string | undefined>>;
  readonly signal: AbortSignal;
  readonly onProgress?: (progress: { readonly phase: 'replay' | 'diff' | 'verdict'; readonly probeName?: ProbeName }) => void;
}

export interface CheckOutcome {
  /** The persisted verdict — the machine-readable result (C12). */
  readonly verdict: Verdict;
  readonly baselineId: string;
}

export class CheckService {
  private readonly options: CheckServiceOptions;

  constructor(options: CheckServiceOptions) {
    this.options = options;
  }

  async check(command: CheckCommand): Promise<CheckOutcome> {
    const opId = ulid();
    const logger = this.options.logger.child({ opId });
    const startedAt = this.options.clock.epochMillis();
    const treeBefore = await this.options.treeDigest();

    const baseline = await this.resolveBaseline(command);
    const checkRun = createCheckRun({ id: ulid(), baselineId: baseline.id, startedAtEpochMs: startedAt });
    await this.options.store.verdicts.saveCheckRun(checkRun);
    logger.info('check.run.start', { baselineId: baseline.id, checkRunId: checkRun.id });

    const rules = compileRules(command.config);
    const replayEngine = new ReplayEngine({
      execution: this.options.execution,
      snapshots: this.options.store.documents,
      logger,
      clock: this.options.clock,
    });

    const replayStarted = this.options.clock.epochMillis();
    try {
      const outcome = await replayEngine.replay({
        baseline,
        probes: toResolvedProbes(command.config, undefined),
        normalize: (result) => normalizeExecution(result, rules),
        currentConfigHash: command.config.configHash,
        currentRulesetVersion: RULESET_VERSION,
        currentInterceptorVersions: {},
        gitCommit: command.gitCommit,
        parentEnv: command.parentEnv,
        signal: command.signal,
        ...(command.onProgress === undefined
          ? {}
          : { onProgress: (p: { probeName: ProbeName }) => command.onProgress?.({ phase: 'replay', probeName: p.probeName }) }),
      });
      const replayMs = this.options.clock.epochMillis() - replayStarted;

      if (outcome.status === 'stale-baseline') {
        return await this.persistVerdict(command, checkRun.id, baseline, {
          status: 'stale-baseline',
          divergences: [],
          replaySnapshots: {},
          staleness: outcome.findings,
          error: null,
          treeBefore,
          startedAt,
          replayMs,
          diffMs: 0,
          logger,
        });
      }

      // Diff every probe in sorted order (global divergence ordering, Doc 06 B1).
      const diffStarted = this.options.clock.epochMillis();
      const divergences: Divergence[] = [];
      const replaySnapshots: Record<ProbeName, ContentHash> = {};
      for (const probeName of Object.keys(outcome.probes).sort()) {
        command.onProgress?.({ phase: 'diff', probeName });
        const replayed = outcome.probes[probeName];
        if (replayed === undefined) continue;

        // Persist replay snapshot + payloads with declared refs (verdict evidence, C12).
        const streamRefs: ContentHash[] = [];
        for (const [hash, bytes] of replayed.payloads) {
          await this.options.store.objects.put(bytes);
          streamRefs.push(hash);
        }
        replaySnapshots[probeName] = await this.options.store.documents.putDocument(
          replayed.snapshot,
          streamRefs,
        );

        const { snapshot: baselineSnapshot, payloads: baselinePayloads } =
          await this.loadBaselineSnapshot(baseline, probeName);
        const probeConfig = command.config.probes[probeName];
        divergences.push(
          ...diffSnapshots(baselineSnapshot, replayed.snapshot, {
            payloads: new Map([...baselinePayloads, ...replayed.payloads]),
            ignoreRules: probeConfig?.ignoreRules ?? [],
          }),
        );
      }
      divergences.sort(compareDivergences);
      const diffMs = this.options.clock.epochMillis() - diffStarted;

      return await this.persistVerdict(command, checkRun.id, baseline, {
        status: divergences.length > 0 ? 'diverged' : 'clean',
        divergences,
        replaySnapshots,
        staleness: outcome.warnings,
        error: null,
        treeBefore,
        startedAt,
        replayMs,
        diffMs,
        logger,
      });
    } catch (error) {
      // Partial-failure policy (Doc 03 §3.9): engine/environment faults across
      // the WHOLE deterministic pipeline become an error verdict — never a
      // silent subset comparison. User errors propagate to the adapter.
      if (error instanceof ExecutionFault || error instanceof EnvironmentError) {
        return this.persistVerdict(command, checkRun.id, baseline, {
          status: 'error',
          divergences: [],
          replaySnapshots: {},
          staleness: [],
          error: {
            scope: 'total',
            failedProbes: [],
            detail: error.message,
          },
          treeBefore,
          startedAt,
          replayMs: this.options.clock.epochMillis() - replayStarted,
          diffMs: 0,
          logger,
        });
      }
      throw error;
    }
  }

  private async resolveBaseline(command: CheckCommand): Promise<Baseline> {
    const { store } = this.options;
    const baseline =
      command.baselineId !== undefined
        ? await store.baselines.getById(command.baselineId)
        : await store.baselines.latestSealedByLabel(command.label);
    if (baseline === undefined) {
      throw new UserError(
        command.baselineId !== undefined
          ? `baseline '${command.baselineId}' not found`
          : `no sealed baseline for label '${command.label}'`,
        {
          code: 'KEEL_E_CHECK_NO_BASELINE',
          remediation: `run 'keel capture' first (ADR-012: baselines resolve by label, default = git branch)`,
          context: { label: command.label },
        },
      );
    }
    return baseline;
  }

  private async loadBaselineSnapshot(
    baseline: Baseline,
    probeName: ProbeName,
  ): Promise<{ snapshot: Snapshot; payloads: Map<ContentHash, Uint8Array> }> {
    const docHash = baseline.snapshots[probeName];
    const snapshot = (await this.options.store.documents.getDocument(docHash ?? '')) as Snapshot;
    const payloads = new Map<ContentHash, Uint8Array>();
    for (const observation of snapshot.observations) {
      if (observation.kind === 'stream') {
        payloads.set(observation.contentHash, await this.options.store.objects.get(observation.contentHash));
      }
    }
    return { snapshot, payloads };
  }

  private async persistVerdict(
    command: CheckCommand,
    checkRunId: string,
    baseline: Baseline,
    parts: {
      status: VerdictStatus;
      divergences: readonly Divergence[];
      replaySnapshots: Readonly<Record<ProbeName, ContentHash>>;
      staleness: readonly StalenessFinding[];
      error: Verdict['error'];
      treeBefore: string | null;
      startedAt: number;
      replayMs: number;
      diffMs: number;
      logger: Logger;
    },
  ): Promise<CheckOutcome> {
    command.onProgress?.({ phase: 'verdict' });
    const treeAfter = await this.options.treeDigest();
    const treeMutated =
      parts.treeBefore !== null && treeAfter !== null && parts.treeBefore !== treeAfter;

    const verdict = createVerdict({
      id: ulid(),
      checkRunId,
      baselineId: baseline.id,
      status: parts.status,
      divergences: parts.divergences,
      replaySnapshots: parts.replaySnapshots,
      codeDiffRef: null,
      treeMutated,
      staleness: parts.staleness,
      error: parts.error,
      timing: {
        replayMs: parts.replayMs,
        diffMs: parts.diffMs,
        classifyMs: 0,
        totalMs: this.options.clock.epochMillis() - parts.startedAt,
      },
    });
    // Facts first (C11): persisted before any adapter sees it, before any
    // future annotation step exists.
    await this.options.store.verdicts.saveVerdict(verdict);
    parts.logger.info('check.run.finish', {
      verdictId: verdict.id,
      status: verdict.status,
      divergences: parts.divergences.length,
      treeMutated,
    });
    return { verdict, baselineId: baseline.id };
  }
}
