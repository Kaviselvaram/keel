/**
 * CaptureService (Doc 20 §11, Phase 4 slice): the use-case seam between the
 * capture engine and the world. Owns: request validation, ConfigSnapshot →
 * capture-input mapping, correlation (opId), progress fan-out. Adapters call
 * this — never the engine (C26).
 *
 * Git provenance is an injected value: acquiring it spawns a process, which
 * belongs to the composition root via the execution platform (C23) and
 * arrives with the Phase 5 CLI.
 */

import { UserError, ulid } from '../shared/index.js';
import type { Clock } from '../shared/index.js';
import type { Logger } from '../observability/index.js';
import type { ConfigSnapshot } from '../config/index.js';
import { BUILTIN_RULES, CaptureEngine, makeRule } from '../capture/index.js';
import type {
  CaptureGitInfo,
  CaptureProbe,
  CaptureProgress,
  CaptureResult,
  NormalizationRule,
} from '../capture/index.js';
import type { ExecutionEngine } from '../execution/index.js';
import type { KeelStore } from '../storage/index.js';

export interface CaptureServiceOptions {
  readonly execution: ExecutionEngine;
  readonly store: KeelStore;
  readonly logger: Logger;
  readonly clock: Clock;
  readonly keelVersion: string;
}

export interface CaptureCommand {
  readonly config: ConfigSnapshot;
  /** Baseline label; ADR-012 default is the git branch — the caller resolves it. */
  readonly label: string;
  /** Restrict to these probe names (all when absent). */
  readonly probeFilter?: readonly string[];
  readonly git: CaptureGitInfo;
  readonly parentEnv: Readonly<Record<string, string | undefined>>;
  readonly signal: AbortSignal;
  readonly onProgress?: (progress: CaptureProgress) => void;
}

function toCaptureProbes(
  config: ConfigSnapshot,
  filter: readonly string[] | undefined,
): readonly CaptureProbe[] {
  const names = Object.keys(config.probes);
  const selected = filter === undefined ? names : filter;
  const probes: CaptureProbe[] = [];
  for (const name of selected) {
    const probe = config.probes[name];
    if (probe === undefined) {
      throw new UserError(`unknown probe '${name}'`, {
        code: 'KEEL_E_CAPTURE_UNKNOWN_PROBE',
        remediation: `declared probes: ${names.join(', ') || '(none)'}`,
        context: { name },
      });
    }
    probes.push({
      name,
      runner: probe.runner,
      command: probe.command,
      args: probe.args,
      cwd: probe.cwd,
      stdinText: probe.stdin,
      envAllowlist: probe.env,
      timeoutMs: probe.timeoutMs,
      maxOutputBytes: probe.maxOutputBytes,
      maxFsEffectBytes: probe.maxFsEffectBytes,
      interception: probe.interception,
      hooks: probe.hooks,
      ignoreRules: probe.ignoreRules,
      serial: probe.serial,
    });
  }
  return probes;
}

function compileRules(config: ConfigSnapshot): readonly NormalizationRule[] {
  const userRules = config.normalizationRules.map((rule) =>
    makeRule(rule.id, rule.pattern, rule.replacement),
  );
  // User rules run after secrets, before/alongside built-in volatiles;
  // built-ins keep priority on secrets by ordering.
  return [...BUILTIN_RULES, ...userRules];
}

export class CaptureService {
  private readonly options: CaptureServiceOptions;

  constructor(options: CaptureServiceOptions) {
    this.options = options;
  }

  async capture(command: CaptureCommand): Promise<CaptureResult> {
    if (command.label.length === 0) {
      throw new UserError('baseline label must be non-empty', {
        code: 'KEEL_E_CAPTURE_INVALID_LABEL',
        remediation: 'pass a label (defaults to the git branch at the CLI)',
      });
    }
    const opId = ulid();
    const logger = this.options.logger.child({ opId });
    const engine = new CaptureEngine({
      execution: this.options.execution,
      objects: this.options.store.objects,
      documents: this.options.store.documents,
      baselines: this.options.store.baselines,
      logger,
      clock: this.options.clock,
      newId: ulid,
    });

    logger.info('capture.run.start', {
      label: command.label,
      probes: command.probeFilter?.length ?? Object.keys(command.config.probes).length,
      verificationCount: command.config.capture.verificationCount,
    });
    const result = await engine.capture({
      label: command.label,
      probes: toCaptureProbes(command.config, command.probeFilter),
      rules: compileRules(command.config),
      configHash: command.config.configHash,
      keelVersion: this.options.keelVersion,
      git: command.git,
      parentEnv: command.parentEnv,
      verificationCount: command.config.capture.verificationCount,
      signal: command.signal,
      ...(command.onProgress === undefined ? {} : { onProgress: command.onProgress }),
    });
    logger.info('capture.run.finish', {
      status: result.status,
      baselineId: result.baseline.id,
    });
    return result;
  }
}
