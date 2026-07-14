#!/usr/bin/env node
/**
 * CLI composition root (C27) — the only CLI file that wires ports to
 * implementations: config load, store open, engine construction, git
 * provenance, tree digest, logger sink. Adapters project; services decide.
 * Exit codes follow the frozen five-code contract (Doc 10 §C2).
 */

import { createRequire } from 'node:module';
import { existsSync, mkdirSync, createWriteStream, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  EXIT_CODES,
  exitCodeForError,
  KeelError,
  systemClock,
  UserError,
} from '../shared/index.js';
import { createNdjsonLogger } from '../observability/index.js';
import type { Logger } from '../observability/index.js';
import { canonicalSerialize } from '../model/index.js';
import { loadConfig } from '../config/index.js';
import { CommandRunner, ExecutionEngine, RunnerRegistry } from '../execution/index.js';
import { KeelStore } from '../storage/index.js';
import {
  BaselineAdminService,
  CaptureService,
  CheckService,
  ReportService,
} from '../services/index.js';
import { runMcpServer } from '../mcp/index.js';
import { parseCli, USAGE } from './args.js';
import { acquireGitProvenance, treeDigest } from './git-provenance.js';
import { renderBaselines, renderCaptureResult, renderReport } from './render.js';

const require = createRequire(import.meta.url);
const { version } = require('../../package.json') as { version: string };

const STARTER_CONFIG = `{
  // KEEL project configuration — https://github.com/Kaviselvaram/keel
  "version": 1,
  "probes": {
    // "app-smoke": { "command": "node", "args": ["dist/main.js", "--once"] },
  },
}
`;

interface Wiring {
  readonly store: KeelStore;
  readonly logger: Logger;
  readonly execution: ExecutionEngine;
}

async function openWiring(storeDir: string): Promise<Wiring> {
  const logsDir = path.join(storeDir, 'logs');
  mkdirSync(logsDir, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  const sink = createWriteStream(path.join(logsDir, `keel-${day}.log`), { flags: 'a' });
  const logger = createNdjsonLogger({ sink: { write: (line) => void sink.write(line) } });
  const store = await KeelStore.open({ directory: storeDir, logger });
  const execution = new ExecutionEngine({ registry: new RunnerRegistry([new CommandRunner()]), logger });
  return { store, logger, execution };
}

function verdictExitCode(status: string, unsuppressedCount: number): number {
  switch (status) {
    case 'clean':
      return EXIT_CODES.clean;
    case 'diverged':
      // Suppressions gate the exit code (their whole purpose in CI) — the
      // persisted facts are untouched (Doc 04).
      return unsuppressedCount > 0 ? EXIT_CODES.diverged : EXIT_CODES.clean;
    case 'stale-baseline':
      return EXIT_CODES.user;
    default:
      return EXIT_CODES.environment;
  }
}

async function main(): Promise<number> {
  const command = parseCli(process.argv.slice(2));
  const cwd = process.cwd();

  switch (command.kind) {
    case 'version':
      console.log(`keel ${version}`);
      return EXIT_CODES.clean;
    case 'help':
      console.log(USAGE);
      return EXIT_CODES.clean;
    case 'invalid':
      console.error(`error: ${command.message} (KEEL_E_CLI_INVALID_ARGUMENTS)`);
      console.error(`fix: run 'keel --help'`);
      return EXIT_CODES.user;
    case 'init': {
      const target = path.join(cwd, 'keel.config.jsonc');
      if (existsSync(target) || existsSync(path.join(cwd, 'keel.config.json'))) {
        console.error('error: a keel config already exists here (KEEL_E_CLI_CONFIG_EXISTS)');
        console.error('fix: edit the existing keel.config.jsonc instead');
        return EXIT_CODES.user;
      }
      writeFileSync(target, STARTER_CONFIG);
      console.log(`created ${target} — declare your probes, then run 'keel capture'`);
      return EXIT_CODES.clean;
    }
    case 'mcp': {
      // MCP session: logs go to the store dir; stdout belongs to the protocol.
      const storeDir = process.env['KEEL_STORE_DIR'] ?? path.join(cwd, '.keel');
      const logsDir = path.join(storeDir, 'logs');
      mkdirSync(logsDir, { recursive: true });
      const day = new Date().toISOString().slice(0, 10);
      const sink = createWriteStream(path.join(logsDir, `keel-mcp-${day}.log`), { flags: 'a' });
      await runMcpServer({
        cwd,
        env: process.env,
        keelVersion: version,
        logger: createNdjsonLogger({ sink: { write: (line) => void sink.write(line) } }),
        input: process.stdin,
        output: { write: (line) => void process.stdout.write(line) },
        acquireGit: () => acquireGitProvenance(cwd),
        treeDigest: () => treeDigest(cwd),
      });
      return EXIT_CODES.clean;
    }
    default:
      break;
  }

  // Store-backed commands share wiring; abort on SIGINT (C44).
  const config = loadConfig({ cwd, env: process.env });
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  const wiring = await openWiring(config.machine.storeDir ?? path.join(cwd, '.keel'));

  try {
    switch (command.kind) {
      case 'capture': {
        const git = await acquireGitProvenance(cwd);
        const label = command.label ?? git.branch ?? 'default';
        const service = new CaptureService({
          execution: wiring.execution,
          store: wiring.store,
          logger: wiring.logger,
          clock: systemClock,
          keelVersion: version,
        });
        const result = await service.capture({
          config,
          label,
          git: { commit: git.commit, dirty: git.dirty },
          parentEnv: process.env,
          signal: controller.signal,
          onProgress: (progress) =>
            console.error(
              progress.phase === 'verify'
                ? `  verify ${progress.probeName} (${String(progress.iteration)})`
                : progress.phase === 'execute'
                  ? `  capture ${progress.probeName}`
                  : `  ${progress.phase}`,
            ),
          ...(command.probes === undefined ? {} : { probeFilter: command.probes }),
        });
        console.log(renderCaptureResult(result));
        return result.status === 'sealed' ? EXIT_CODES.clean : EXIT_CODES.user;
      }
      case 'check': {
        const git = await acquireGitProvenance(cwd);
        const label = command.label ?? git.branch ?? 'default';
        const service = new CheckService({
          execution: wiring.execution,
          store: wiring.store,
          logger: wiring.logger,
          clock: systemClock,
          treeDigest: () => treeDigest(cwd),
        });
        const outcome = await service.check({
          config,
          label,
          gitCommit: git.commit,
          parentEnv: process.env,
          signal: controller.signal,
          onProgress: (progress) =>
            console.error(`  ${progress.phase}${progress.probeName === undefined ? '' : ` ${progress.probeName}`}`),
          ...(command.baselineId === undefined ? {} : { baselineId: command.baselineId }),
        });
        const reports = new ReportService({ store: wiring.store, logger: wiring.logger, clock: systemClock });
        const report = await reports.report(outcome.verdict);
        console.log(command.json ? canonicalSerialize(report) : renderReport(report));
        return verdictExitCode(report.verdict.status, report.unsuppressedCount);
      }
      case 'report': {
        const reports = new ReportService({ store: wiring.store, logger: wiring.logger, clock: systemClock });
        const report = await reports.report(command.verdictId);
        console.log(command.json ? canonicalSerialize(report) : renderReport(report));
        return verdictExitCode(report.verdict.status, report.unsuppressedCount);
      }
      case 'baseline-ls':
        console.log(renderBaselines(new BaselineAdminService(wiring.store).list()));
        return EXIT_CODES.clean;
      case 'baseline-rm':
        new BaselineAdminService(wiring.store).remove(command.id);
        console.log(`removed baseline ${command.id} (objects reclaimable via gc)`);
        return EXIT_CODES.clean;
      default:
        return EXIT_CODES.internal;
    }
  } finally {
    await wiring.store.close();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    if (error instanceof KeelError) {
      console.error(`error: ${error.message} (${error.code})`);
      if (error instanceof UserError) console.error(`fix: ${error.remediation}`);
    } else {
      console.error(`internal error: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      console.error('this is a KEEL bug — please report it');
    }
    process.exitCode = exitCodeForError(error);
  });
