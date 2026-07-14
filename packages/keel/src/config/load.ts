/**
 * Layered configuration loading — Doc 10 Part A, Doc 20 §9, ADR-011.
 *
 * Hierarchy (lowest → highest): built-in defaults → project keel.config.jsonc
 * → user file (machine-local prefs only) → KEEL_* env → invocation overrides.
 * This module is the ONLY reader of env vars and config files in KEEL (C64);
 * everything downstream receives the frozen ConfigSnapshot.
 *
 * The behavior hash is computed over the canonical PARSED form of the
 * behavior-affecting subset (probes + normalization rules): comments,
 * formatting, machine-local preferences, and the verification count (a trust
 * process knob, not captured-behavior content) can never invalidate a
 * baseline.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { parse as parseJsonc } from 'jsonc-parser';
import type { ParseError } from 'jsonc-parser';
import { printParseErrorCode } from 'jsonc-parser';
import { contentHashOf } from '../model/index.js';
import {
  CAPTURE_DEFAULTS,
  configError,
  MACHINE_DEFAULTS,
  validateProjectConfig,
  validateUserConfig,
} from './schema.js';
import type { ConfigSnapshot, MachineConfig } from './schema.js';
import { resolveStoreDirectory } from './store-location.js';

export interface LoadConfigOptions {
  /** Worktree root (process.cwd() at the composition root). */
  readonly cwd: string;
  /** Injected environment (process.env at the composition root). */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Explicit project file path (tests / --config flag); default: keel.config.jsonc|json in cwd. */
  readonly projectFile?: string;
  /** Explicit user file path (tests); default: ~/.config/keel/config.json. */
  readonly userFile?: string;
  /** Invocation-level overrides (highest precedence; cannot define probes by construction). */
  readonly overrides?: {
    readonly verificationCount?: number;
    readonly logLevel?: MachineConfig['logLevel'];
  };
}

function lineColumn(text: string, offset: number): string {
  let line = 1;
  let column = 1;
  for (let index = 0; index < offset && index < text.length; index++) {
    if (text[index] === '\n') {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return `${String(line)}:${String(column)}`;
}

function parseConfigText(text: string, sourcePath: string): unknown {
  const errors: ParseError[] = [];
  const value = parseJsonc(text, errors, { allowTrailingComma: true }) as unknown;
  const firstError = errors[0];
  if (firstError !== undefined) {
    throw configError(
      `invalid JSONC (${printParseErrorCode(firstError.error)} at ${lineColumn(text, firstError.offset)})`,
      sourcePath,
    );
  }
  return value;
}

function findProjectFile(cwd: string, explicit: string | undefined): string | undefined {
  if (explicit !== undefined) return path.resolve(cwd, explicit);
  for (const candidate of ['keel.config.jsonc', 'keel.config.json']) {
    const file = path.resolve(cwd, candidate);
    try {
      readFileSync(file);
      return file;
    } catch {
      // try next candidate
    }
  }
  return undefined;
}

function deepFreezeConfig<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreezeConfig((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

export function loadConfig(options: LoadConfigOptions): ConfigSnapshot {
  // 1-2. defaults + project file
  const projectFile = findProjectFile(options.cwd, options.projectFile);
  if (projectFile === undefined) {
    throw configError(
      'no keel.config.jsonc (or .json) found',
      path.resolve(options.cwd, 'keel.config.jsonc'),
      { cwd: options.cwd },
    );
  }
  const projectText = readFileSync(projectFile, 'utf8');
  const project = validateProjectConfig(parseConfigText(projectText, projectFile), projectFile);

  // 3. user file (machine-local; absent is fine)
  const userFile = options.userFile ?? path.join(homedir(), '.config', 'keel', 'config.json');
  let userMachine: Partial<MachineConfig> = {};
  let userText: string | undefined;
  try {
    userText = readFileSync(userFile, 'utf8');
  } catch {
    userText = undefined;
  }
  if (userText !== undefined) {
    userMachine = validateUserConfig(parseConfigText(userText, userFile), userFile);
  }

  // 4. environment
  const envLogLevel = options.env['KEEL_LOG_LEVEL'];
  if (
    envLogLevel !== undefined &&
    !['error', 'warn', 'info', 'debug', 'trace'].includes(envLogLevel)
  ) {
    throw configError('expected one of error | warn | info | debug | trace', 'KEEL_LOG_LEVEL', {
      received: envLogLevel,
    });
  }
  const envNoClassify = options.env['KEEL_NO_CLASSIFY'];

  const machine: MachineConfig = {
    logLevel:
      options.overrides?.logLevel ??
      (envLogLevel as MachineConfig['logLevel'] | undefined) ??
      userMachine.logLevel ??
      MACHINE_DEFAULTS.logLevel,
    storeDir: resolveStoreDirectory({
      cwd: options.cwd,
      env: {
        KEEL_STORE_DIR: options.env['KEEL_STORE_DIR'] ?? userMachine.storeDir ?? undefined,
      },
    }),
    inferenceUrl: options.env['KEEL_INFERENCE_URL'] ?? userMachine.inferenceUrl ?? null,
    noClassify: envNoClassify === '1' || envNoClassify === 'true' || MACHINE_DEFAULTS.noClassify,
  };

  // 5. invocation overrides
  const verificationCount =
    options.overrides?.verificationCount ??
    project.capture.verificationCount ??
    CAPTURE_DEFAULTS.verificationCount;

  // Behavior hash: canonical parsed form of the behavior-affecting subset (ADR-011).
  const configHash = contentHashOf({
    version: 1,
    probes: project.probes,
    normalizationRules: project.normalizationRules,
  });

  return deepFreezeConfig({
    version: 1 as const,
    probes: project.probes,
    capture: { verificationCount },
    normalizationRules: project.normalizationRules,
    machine,
    configHash,
  });
}
