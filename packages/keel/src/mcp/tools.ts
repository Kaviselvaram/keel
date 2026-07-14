/**
 * Tool handlers — pure projections (C26): validate → call services → shape
 * the structured result + summary. Every domain outcome is a SUCCESSFUL
 * result with machine-readable status/remediation (Doc 09 §4); the only
 * errors that escape are internal bugs.
 */

import { KeelError, UserError } from '../shared/index.js';
import type {
  BaselineAdminService,
  CaptureService,
  CheckService,
  ReportService,
  SuppressionService,
} from '../services/index.js';
import type { ConfigSnapshot } from '../config/index.js';
import { KEEL_MCP_SCHEMA_VERSION } from './schemas.js';

/** What a tool call runs against — constructed per call by the composition root, closed after. */
export interface ToolRuntime {
  /** Config load outcome: status must answer gracefully when uninitialized. */
  readonly config:
    | { readonly ok: true; readonly snapshot: ConfigSnapshot }
    | { readonly ok: false; readonly problem: string };
  readonly services?: {
    readonly capture: CaptureService;
    readonly check: CheckService;
    readonly report: ReportService;
    readonly baselines: BaselineAdminService;
    readonly suppressions: SuppressionService;
  };
  readonly git: { readonly commit: string | null; readonly dirty: boolean; readonly branch: string | null };
  readonly parentEnv: Readonly<Record<string, string | undefined>>;
  readonly keelVersion: string;
}

export interface ToolCallContext {
  readonly signal: AbortSignal;
  readonly onProgress: (progress: number, message: string) => void;
}

/** Every tool returns the structured document plus a one-line human summary. */
export interface ToolOutcome {
  readonly summary: string;
  readonly document: Record<string, unknown>;
  readonly isError: boolean;
}

const ok = (summary: string, document: Record<string, unknown>): ToolOutcome => ({
  summary,
  document: { keelSchemaVersion: KEEL_MCP_SCHEMA_VERSION, ...document },
  isError: false,
});

/** Domain failures as structured results (Doc 09 §4) — never thrown across the protocol. */
function structuredError(error: unknown): ToolOutcome {
  if (error instanceof KeelError) {
    return {
      summary: `error: ${error.message}`,
      document: {
        keelSchemaVersion: KEEL_MCP_SCHEMA_VERSION,
        status: 'error',
        errorClass: error instanceof UserError ? 'user' : error.name,
        code: error.code,
        message: error.message,
        ...(error instanceof UserError ? { remediation: error.remediation } : {}),
      },
      isError: true,
    };
  }
  throw error; // internal bugs crash loudly (C59) — the server maps them once, at the top
}

const NOT_INITIALIZED = (problem: string): ToolOutcome => ({
  summary: 'KEEL is not initialized in this workspace',
  document: {
    keelSchemaVersion: KEEL_MCP_SCHEMA_VERSION,
    status: 'not-initialized',
    problem,
    remediation: { action: 'init', detail: "run 'keel init' and declare probes in keel.config.jsonc" },
  },
  isError: false,
});

type Handler = (runtime: ToolRuntime, args: Record<string, unknown>, context: ToolCallContext) => Promise<ToolOutcome>;

const requireServices = (
  runtime: ToolRuntime,
): { snapshot: ConfigSnapshot; services: NonNullable<ToolRuntime['services']> } | undefined =>
  runtime.config.ok && runtime.services !== undefined
    ? { snapshot: runtime.config.snapshot, services: runtime.services }
    : undefined;

export const TOOL_HANDLERS: Readonly<Record<string, Handler>> = {
  async keel_status(runtime) {
    if (!runtime.config.ok) return NOT_INITIALIZED(runtime.config.problem);
    const ready = requireServices(runtime);
    const baselines = ready?.services.baselines.list() ?? [];
    return ok(
      `initialized: ${String(Object.keys(runtime.config.snapshot.probes).length)} probes, ${String(baselines.length)} baselines`,
      {
        status: 'ok',
        initialized: true,
        probeCount: Object.keys(runtime.config.snapshot.probes).length,
        verificationCount: runtime.config.snapshot.capture.verificationCount,
        baselines: baselines.map((summary) => ({
          id: summary.id,
          label: summary.label,
          status: summary.status,
          sealedAtEpochMs: summary.sealedAtEpochMs,
        })),
        classification: { available: false, reason: 'classification arrives in Phase 9 (local-only when it does)' },
        git: runtime.git,
      },
    );
  },

  async keel_capture(runtime, args, context) {
    const ready = requireServices(runtime);
    if (ready === undefined) return NOT_INITIALIZED(runtime.config.ok ? 'store unavailable' : runtime.config.problem);
    try {
      let steps = 0;
      const result = await ready.services.capture.capture({
        config: ready.snapshot,
        label: args['label'] as string,
        git: { commit: runtime.git.commit, dirty: runtime.git.dirty },
        parentEnv: runtime.parentEnv,
        signal: context.signal,
        onProgress: (progress) =>
          context.onProgress(++steps, `${progress.phase}${'probeName' in progress ? ` ${progress.probeName}` : ''}`),
        ...(args['probes'] === undefined ? {} : { probeFilter: args['probes'] as string[] }),
      });
      if (result.status === 'sealed') {
        return ok(`baseline ${result.baseline.id} sealed (label=${result.baseline.label})`, {
          status: 'sealed',
          baselineId: result.baseline.id,
          label: result.baseline.label,
          provenance: result.baseline.provenance,
          secretFindings: result.secretFindings,
        });
      }
      return ok(
        `baseline rejected: probe '${result.rejection.probeName}' flaps at ${result.rejection.flappingPath}`,
        { status: 'rejected', rejection: result.rejection, baselineId: result.baseline.id },
      );
    } catch (error) {
      return structuredError(error);
    }
  },

  async keel_check(runtime, args, context) {
    const ready = requireServices(runtime);
    if (ready === undefined) return NOT_INITIALIZED(runtime.config.ok ? 'store unavailable' : runtime.config.problem);
    try {
      const probes = args['probes'] as string[] | undefined;
      const scope =
        probes !== undefined
          ? ({ kind: 'probes', names: probes } as const)
          : args['all'] === true
            ? ({ kind: 'all' } as const)
            : ({ kind: 'diff' } as const);
      let steps = 0;
      const outcome = await ready.services.check.check({
        config: ready.snapshot,
        label: (args['label'] as string | undefined) ?? runtime.git.branch ?? 'default',
        scope,
        gitCommit: runtime.git.commit,
        parentEnv: runtime.parentEnv,
        signal: context.signal,
        onProgress: (progress) =>
          context.onProgress(++steps, `${progress.phase}${progress.probeName === undefined ? '' : ` ${progress.probeName}`}`),
        ...(args['baselineId'] === undefined ? {} : { baselineId: args['baselineId'] as string }),
      });
      const report = await ready.services.report.report(outcome.verdict);
      return ok(
        `${outcome.verdict.status}: ${String(report.unsuppressedCount)} unsuppressed divergence(s)`,
        {
          status: outcome.verdict.status,
          report,
          scope: {
            requested: scope.kind,
            effective: scope.kind === 'probes' ? 'named-probes' : 'all-probes (v1 sound over-approximation; Phase 12 narrows)',
          },
          ...(args['classify'] === true
            ? { classification: { available: false, reason: 'classification arrives in Phase 9' } }
            : {}),
        },
      );
    } catch (error) {
      return structuredError(error);
    }
  },

  async keel_explain(runtime, args) {
    const ready = requireServices(runtime);
    if (ready === undefined) return NOT_INITIALIZED(runtime.config.ok ? 'store unavailable' : runtime.config.problem);
    try {
      const explain = await ready.services.report.explain(
        args['stableId'] as string,
        args['verdictId'] as string | undefined,
      );
      return ok(
        `${explain.divergence.kind} at ${explain.formattedPath} (probe ${explain.divergence.probeName})`,
        { status: 'ok', explain },
      );
    } catch (error) {
      return structuredError(error);
    }
  },

  async keel_suppress(runtime, args) {
    const ready = requireServices(runtime);
    if (ready === undefined) return NOT_INITIALIZED(runtime.config.ok ? 'store unavailable' : runtime.config.problem);
    try {
      const suppression = await ready.services.suppressions.suppress({
        reason: args['reason'] as string,
        createdBy: 'mcp',
        ...(args['stableId'] === undefined ? {} : { stableId: args['stableId'] as string }),
        ...(args['pattern'] === undefined ? {} : { pattern: args['pattern'] as string }),
        ...(args['expiresInDays'] === undefined ? {} : { expiresInDays: args['expiresInDays'] as number }),
      });
      return ok(`suppression ${suppression.id} recorded`, {
        status: 'created',
        suppression: {
          id: suppression.id,
          target: suppression.target,
          reason: suppression.reason,
          expiryEpochMs: suppression.expiryEpochMs,
        },
      });
    } catch (error) {
      return structuredError(error);
    }
  },
};
