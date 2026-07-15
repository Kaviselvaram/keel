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
  withAnnotations,
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
import type {
  CodeDiffSource,
  DivergenceEvidence,
  IntentClassifierPort,
} from './classifier-port.js';

/** Bound on the value excerpt handed to the classifier (evidence stays small). */
const MAX_EXCERPT_BYTES = 4096;

/** Interceptor versions the current environment would arm — mirrors capture's union (Doc 06 A4). */
function currentInterceptorVersions(
  config: ConfigSnapshot,
  capabilitiesOf: (runnerId: string) => { interceptors: Readonly<Partial<Record<string, string>>> },
): Record<string, string> {
  const versions: Record<string, string> = {};
  for (const probe of Object.values(config.probes)) {
    const offered = capabilitiesOf(probe.runner).interceptors;
    const wants: string[] = [];
    if (probe.interception.clock === 'virtual') wants.push('clock');
    if (probe.interception.rng === 'seeded') wants.push('rng');
    if (probe.interception.network !== 'forbidden' || probe.runner !== 'command') wants.push('network');
    for (const capability of wants) {
      const version = offered[capability];
      if (version !== undefined) versions[capability] = version;
    }
  }
  return versions;
}

/** v1 scope resolution: sound over-approximation — 'diff' cannot prove any probe unaffected yet (Phase 12). */
function resolveScope(scope: CheckCommand['scope']): readonly string[] | undefined {
  return scope?.kind === 'probes' ? scope.names : undefined;
}

/** ADR-013 port: digest of the working tree, null when not applicable (not a git repo). */
export type TreeDigest = () => Promise<string | null>;

export interface CheckServiceOptions {
  readonly execution: ExecutionEngine;
  readonly store: KeelStore;
  readonly logger: Logger;
  readonly clock: Clock;
  readonly treeDigest: TreeDigest;
  /**
   * Advisory classifier (Doc 20 §6). Optional and consumer-owned (C22): when
   * absent — including the AI-deletable build (C3) — checks run identically
   * with zero annotations. Wired only at composition roots.
   */
  readonly classifier?: IntentClassifierPort;
  /** Injected code-diff source for the classifier's evidence (C23). */
  readonly codeDiff?: CodeDiffSource;
}

export interface CheckCommand {
  readonly config: ConfigSnapshot;
  /** Explicit baseline id, or resolution by label (ADR-012: latest sealed for the label). */
  readonly baselineId?: string;
  readonly label: string;
  /**
   * Probe scope (Doc 09 §3): 'diff' (default) runs probes plausibly affected
   * by the current edit — v1 soundly over-approximates to ALL probes (no
   * dependency map until Phase 12; this seam is where it lands); 'all'
   * forces full replay explicitly; 'probes' names an exact subset.
   */
  readonly scope?:
    | { readonly kind: 'diff' }
    | { readonly kind: 'all' }
    | { readonly kind: 'probes'; readonly names: readonly string[] };
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
        probes: toResolvedProbes(command.config, resolveScope(command.scope)),
        normalize: (result) => normalizeExecution(result, rules),
        currentConfigHash: command.config.configHash,
        currentRulesetVersion: RULESET_VERSION,
        currentInterceptorVersions: currentInterceptorVersions(command.config, (id) =>
          this.options.execution.capabilitiesOf(id),
        ),
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
    // Facts first (C11): persisted before any adapter sees it and before the
    // advisory classification step below.
    await this.options.store.verdicts.saveVerdict(verdict);

    // Advisory classification (Doc 07, Doc 20 §6): additive annotations,
    // strictly after facts. Total failure degrades to no annotations — never
    // fails the check, never alters facts.
    const annotated = await this.classify(verdict, command, baseline, parts.logger);

    parts.logger.info('check.run.finish', {
      verdictId: verdict.id,
      status: verdict.status,
      divergences: parts.divergences.length,
      annotations: annotated.annotations.length,
      treeMutated,
    });
    return { verdict: annotated, baselineId: baseline.id };
  }

  /** Runs Tier-1 classification and persists annotations; returns the (possibly annotated) verdict. */
  private async classify(
    verdict: Verdict,
    command: CheckCommand,
    baseline: Baseline,
    logger: Logger,
  ): Promise<Verdict> {
    const classifier = this.options.classifier;
    if (classifier === undefined || verdict.status !== 'diverged' || verdict.divergences.length === 0) {
      return verdict;
    }
    try {
      const codeDiff = (await this.options.codeDiff?.(baseline.provenance.gitCommit)) ?? '';
      const suppressedStableIds = (await this.options.store.suppressions.listByStatus('active'))
        .filter((suppression) => suppression.target.kind === 'stable-id')
        .map((suppression) => (suppression.target as { readonly stableId: string }).stableId);
      const evidence = await Promise.all(
        verdict.divergences.map((divergence) => this.buildEvidence(divergence)),
      );
      const probes = Object.fromEntries(
        Object.entries(command.config.probes).map(([name, probe]) => [
          name,
          { runner: probe.runner, referencedPaths: [probe.command, ...probe.args] },
        ]),
      );
      const annotations = await classifier.classify({
        evidence,
        codeDiff,
        probes,
        suppressedStableIds,
        signal: command.signal,
      });
      if (annotations.length === 0) return verdict;
      const annotated = withAnnotations(verdict, annotations);
      await this.options.store.verdicts.attachAnnotations(annotated);
      return annotated;
    } catch (error) {
      // Advisory (Doc 20 §6): classification failure is visible but never
      // fails a check — the facts are already safely persisted.
      logger.warn('check.classify.degraded', {
        verdictId: verdict.id,
        detail: error instanceof Error ? error.message : String(error),
      });
      return verdict;
    }
  }

  /** Resolves bounded value excerpts for one divergence (whole-stream refs only; leaf refs are identity-only). */
  private async buildEvidence(divergence: Divergence): Promise<DivergenceEvidence> {
    return {
      divergence,
      baselineExcerpt: await this.excerpt(divergence.baselineValueRef),
      candidateExcerpt: await this.excerpt(divergence.candidateValueRef),
    };
  }

  private async excerpt(ref: ContentHash | null): Promise<string | null> {
    if (ref === null) return null;
    try {
      const bytes = await this.options.store.objects.get(ref);
      return new TextDecoder().decode(bytes.subarray(0, MAX_EXCERPT_BYTES));
    } catch {
      return null; // leaf-value refs are not materialized in v1
    }
  }
}
