/**
 * Configuration schema, defaults, and validation — Doc 10 Part A, Doc 20 §9.
 *
 * Hand-rolled validator ("Zod-style" per Doc 10 describes the single-source
 * shape, not a dependency): every error is path-precise (path + expected +
 * received), unknown keys are hard errors (A2 — a typo'd key silently doing
 * nothing is an oracle-integrity bug), and the project-vs-user key split is
 * enforced structurally. Failure boundary: UserError exclusively (Doc 20 §9).
 */

import { UserError } from '../shared/index.js';
import type { ErrorContext } from '../shared/index.js';

/** One declared probe, as configuration (resolution to a model ProbeSpec is capture's job). */
export interface ProbeConfig {
  readonly runner: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly stdin: string | null;
  readonly env: readonly string[];
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly maxFsEffectBytes: number;
  readonly interception: {
    readonly clock: 'virtual' | 'none';
    readonly rng: 'seeded' | 'none';
    readonly network: 'record' | 'stub' | 'forbidden';
  };
  readonly hooks: { readonly setup?: string; readonly teardown?: string };
  readonly ignoreRules: readonly string[];
  readonly serial: boolean;
}

/** User-declared normalization scrub rule (joins the built-in ruleset). */
export interface NormalizationRuleConfig {
  readonly id: string;
  readonly pattern: string;
  readonly replacement: string;
}

/** Machine-local, presentation-only settings (user file + env; never hashed, never probes — Doc 10 A1.3). */
export interface MachineConfig {
  readonly logLevel: 'error' | 'warn' | 'info' | 'debug' | 'trace';
  readonly storeDir: string | null;
  readonly inferenceUrl: string | null;
  readonly noClassify: boolean;
}

export interface ConfigSnapshot {
  readonly version: 1;
  readonly probes: Readonly<Record<string, ProbeConfig>>;
  readonly capture: { readonly verificationCount: number };
  readonly normalizationRules: readonly NormalizationRuleConfig[];
  readonly machine: MachineConfig;
  /** Hash of the behavior-affecting subset in canonical parsed form (ADR-011). */
  readonly configHash: string;
}

export const PROBE_DEFAULTS = {
  runner: 'command',
  args: [] as readonly string[],
  cwd: '.',
  stdin: null,
  env: [] as readonly string[],
  timeoutMs: 30_000,
  maxOutputBytes: 1_048_576,
  maxFsEffectBytes: 10_485_760,
  interception: { clock: 'none', rng: 'none', network: 'forbidden' } as ProbeConfig['interception'],
  hooks: {},
  ignoreRules: [] as readonly string[],
  serial: false,
} as const;

export const CAPTURE_DEFAULTS = { verificationCount: 2 } as const;

export const MACHINE_DEFAULTS: MachineConfig = {
  logLevel: 'info',
  storeDir: null,
  inferenceUrl: null,
  noClassify: false,
};

export function configError(message: string, path: string, context: ErrorContext = {}): UserError {
  return new UserError(`${path}: ${message}`, {
    code: 'KEEL_E_CONFIG_INVALID',
    remediation: `fix '${path}' in your configuration`,
    docsLink: 'https://github.com/Kaviselvaram/keel/blob/main/docs/guides/configuration.md',
    context: { path, ...context },
  });
}

/* ── tiny path-precise validation combinators (internal) ─────────────── */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function expectRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw configError(`expected an object, received ${typeof value}`, path);
  return value;
}

function expectString(value: unknown, path: string): string {
  if (typeof value !== 'string') throw configError(`expected a string, received ${typeof value}`, path);
  return value;
}

function expectBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw configError(`expected a boolean, received ${typeof value}`, path);
  return value;
}

function expectPositiveInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw configError('expected a positive integer', path, { received: value });
  }
  return value;
}

function expectStringArray(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value)) throw configError('expected an array of strings', path);
  return value.map((item, index) => expectString(item, `${path}[${String(index)}]`));
}

function expectEnum<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw configError(`expected one of ${allowed.join(' | ')}`, path, { received: value });
  }
  return value as T;
}

function rejectUnknownKeys(record: Record<string, unknown>, known: readonly string[], path: string): void {
  for (const key of Object.keys(record)) {
    if (!known.includes(key)) {
      throw configError(`unknown key '${key}' (known keys: ${known.join(', ')})`, path);
    }
  }
}

const PROBE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function validateProbe(name: string, raw: unknown, path: string): ProbeConfig {
  if (!PROBE_NAME.test(name)) {
    throw configError(
      "probe names are 1-128 chars: alphanumerics then '.', '_', '-'",
      `${path} (name '${name}')`,
    );
  }
  const record = expectRecord(raw, path);
  rejectUnknownKeys(
    record,
    ['runner', 'command', 'args', 'cwd', 'stdin', 'env', 'timeoutMs', 'maxOutputBytes', 'maxFsEffectBytes', 'interception', 'hooks', 'ignoreRules', 'serial'],
    path,
  );
  if (record['command'] === undefined) throw configError('a probe requires a command', `${path}.command`);

  const interceptionRaw = record['interception'];
  let interception = PROBE_DEFAULTS.interception;
  if (interceptionRaw !== undefined) {
    const rec = expectRecord(interceptionRaw, `${path}.interception`);
    rejectUnknownKeys(rec, ['clock', 'rng', 'network'], `${path}.interception`);
    interception = {
      clock: rec['clock'] === undefined ? 'none' : expectEnum(rec['clock'], ['virtual', 'none'], `${path}.interception.clock`),
      rng: rec['rng'] === undefined ? 'none' : expectEnum(rec['rng'], ['seeded', 'none'], `${path}.interception.rng`),
      network:
        rec['network'] === undefined
          ? 'forbidden'
          : expectEnum(rec['network'], ['record', 'stub', 'forbidden'], `${path}.interception.network`),
    };
  }

  const hooksRaw = record['hooks'];
  let hooks: ProbeConfig['hooks'] = PROBE_DEFAULTS.hooks;
  if (hooksRaw !== undefined) {
    const rec = expectRecord(hooksRaw, `${path}.hooks`);
    rejectUnknownKeys(rec, ['setup', 'teardown'], `${path}.hooks`);
    hooks = {
      ...(rec['setup'] === undefined ? {} : { setup: expectString(rec['setup'], `${path}.hooks.setup`) }),
      ...(rec['teardown'] === undefined ? {} : { teardown: expectString(rec['teardown'], `${path}.hooks.teardown`) }),
    };
  }

  return {
    runner: record['runner'] === undefined ? PROBE_DEFAULTS.runner : expectString(record['runner'], `${path}.runner`),
    command: expectString(record['command'], `${path}.command`),
    args: record['args'] === undefined ? PROBE_DEFAULTS.args : expectStringArray(record['args'], `${path}.args`),
    cwd: record['cwd'] === undefined ? PROBE_DEFAULTS.cwd : expectString(record['cwd'], `${path}.cwd`),
    stdin: record['stdin'] === undefined ? null : expectString(record['stdin'], `${path}.stdin`),
    env: record['env'] === undefined ? PROBE_DEFAULTS.env : expectStringArray(record['env'], `${path}.env`),
    timeoutMs: record['timeoutMs'] === undefined ? PROBE_DEFAULTS.timeoutMs : expectPositiveInteger(record['timeoutMs'], `${path}.timeoutMs`),
    maxOutputBytes:
      record['maxOutputBytes'] === undefined ? PROBE_DEFAULTS.maxOutputBytes : expectPositiveInteger(record['maxOutputBytes'], `${path}.maxOutputBytes`),
    maxFsEffectBytes:
      record['maxFsEffectBytes'] === undefined
        ? PROBE_DEFAULTS.maxFsEffectBytes
        : expectPositiveInteger(record['maxFsEffectBytes'], `${path}.maxFsEffectBytes`),
    interception,
    hooks,
    ignoreRules:
      record['ignoreRules'] === undefined ? PROBE_DEFAULTS.ignoreRules : expectStringArray(record['ignoreRules'], `${path}.ignoreRules`),
    serial: record['serial'] === undefined ? PROBE_DEFAULTS.serial : expectBoolean(record['serial'], `${path}.serial`),
  };
}

export interface ValidatedProjectConfig {
  readonly probes: Readonly<Record<string, ProbeConfig>>;
  readonly capture: { readonly verificationCount: number };
  readonly normalizationRules: readonly NormalizationRuleConfig[];
}

export function validateProjectConfig(raw: unknown, sourcePath: string): ValidatedProjectConfig {
  const record = expectRecord(raw, sourcePath);
  rejectUnknownKeys(record, ['version', 'probes', 'capture', 'normalization'], sourcePath);
  if (record['version'] !== 1) {
    throw configError('expected version: 1', `${sourcePath}.version`, { received: record['version'] });
  }

  const probes: Record<string, ProbeConfig> = {};
  const probesRaw = record['probes'];
  if (probesRaw !== undefined) {
    for (const [name, value] of Object.entries(expectRecord(probesRaw, `${sourcePath}.probes`))) {
      probes[name] = validateProbe(name, value, `${sourcePath}.probes.${name}`);
    }
  }

  let verificationCount: number = CAPTURE_DEFAULTS.verificationCount;
  const captureRaw = record['capture'];
  if (captureRaw !== undefined) {
    const rec = expectRecord(captureRaw, `${sourcePath}.capture`);
    rejectUnknownKeys(rec, ['verificationCount'], `${sourcePath}.capture`);
    if (rec['verificationCount'] !== undefined) {
      verificationCount = expectPositiveInteger(rec['verificationCount'], `${sourcePath}.capture.verificationCount`);
    }
  }

  const rules: NormalizationRuleConfig[] = [];
  const normalizationRaw = record['normalization'];
  if (normalizationRaw !== undefined) {
    const rec = expectRecord(normalizationRaw, `${sourcePath}.normalization`);
    rejectUnknownKeys(rec, ['rules'], `${sourcePath}.normalization`);
    const listRaw = rec['rules'];
    if (listRaw !== undefined) {
      if (!Array.isArray(listRaw)) throw configError('expected an array of rules', `${sourcePath}.normalization.rules`);
      listRaw.forEach((item, index) => {
        const rulePath = `${sourcePath}.normalization.rules[${String(index)}]`;
        const ruleRecord = expectRecord(item, rulePath);
        rejectUnknownKeys(ruleRecord, ['id', 'pattern', 'replacement'], rulePath);
        const pattern = expectString(ruleRecord['pattern'], `${rulePath}.pattern`);
        try {
          new RegExp(pattern, 'g');
        } catch {
          throw configError('pattern is not a valid regular expression', `${rulePath}.pattern`, { pattern });
        }
        rules.push({
          id: expectString(ruleRecord['id'], `${rulePath}.id`),
          pattern,
          replacement: expectString(ruleRecord['replacement'], `${rulePath}.replacement`),
        });
      });
    }
  }

  return { probes, capture: { verificationCount }, normalizationRules: rules };
}

/** User file: machine-local preferences only — probes/rules are structurally impossible here (Doc 10 A1.3). */
export function validateUserConfig(raw: unknown, sourcePath: string): Partial<MachineConfig> {
  const record = expectRecord(raw, sourcePath);
  rejectUnknownKeys(record, ['logLevel', 'storeDir', 'inferenceUrl'], sourcePath);
  return {
    ...(record['logLevel'] === undefined
      ? {}
      : { logLevel: expectEnum(record['logLevel'], ['error', 'warn', 'info', 'debug', 'trace'], `${sourcePath}.logLevel`) }),
    ...(record['storeDir'] === undefined ? {} : { storeDir: expectString(record['storeDir'], `${sourcePath}.storeDir`) }),
    ...(record['inferenceUrl'] === undefined
      ? {}
      : { inferenceUrl: expectString(record['inferenceUrl'], `${sourcePath}.inferenceUrl`) }),
  };
}
