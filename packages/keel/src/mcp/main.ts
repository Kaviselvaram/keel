/**
 * MCP composition root (Doc 21: one of the two files where ports meet
 * implementations). Builds the per-call ToolRuntime: config load → store →
 * engines → services. Git provenance and the ADR-013 tree digest arrive as
 * injected ports from the spawning composition root (`keel mcp` in the CLI)
 * so mcp/ never imports cli/.
 */

import { systemClock, UserError } from '../shared/index.js';
import type { Logger } from '../observability/index.js';
import { loadConfig } from '../config/index.js';
import { CommandRunner, ExecutionEngine, NodeRunner, RunnerRegistry } from '../execution/index.js';
import { KeelStore } from '../storage/index.js';
import {
  BaselineAdminService,
  CaptureService,
  CheckService,
  ReportService,
  SuppressionService,
} from '../services/index.js';
import { HeuristicClassifier } from '../classify/index.js';
import type { TreeDigest } from '../services/index.js';
import { McpServer } from './server.js';
import type { ToolRuntimeFactory } from './server.js';
import type { ToolRuntime } from './tools.js';
import type { LineWriter } from './jsonrpc.js';
import type { Readable } from 'node:stream';

export interface RunMcpServerOptions {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly keelVersion: string;
  readonly logger: Logger;
  readonly input: Readable;
  readonly output: LineWriter;
  /** Injected composition ports (spawning root owns process acquisition — the recorded C23 ruling). */
  readonly acquireGit: () => Promise<{ commit: string | null; dirty: boolean; branch: string | null }>;
  readonly treeDigest: TreeDigest;
  /** Injected code-diff source for the advisory classifier (C23). */
  readonly codeDiff: (baselineCommit: string | null) => Promise<string>;
}

/** Serves one MCP session over the provided stdio; resolves when the session ends. */
export async function runMcpServer(options: RunMcpServerOptions): Promise<void> {
  const factory: ToolRuntimeFactory = {
    async acquire(signal) {
      void signal; // cancellation reaches services via each command's own signal
      let runtime: ToolRuntime;
      let store: KeelStore | undefined;
      const git = await options.acquireGit();
      try {
        const snapshot = loadConfig({ cwd: options.cwd, env: options.env });
        store = await KeelStore.open({
          directory: snapshot.machine.storeDir ?? `${options.cwd}/.keel`,
          logger: options.logger,
          lockTimeoutMs: 3_000,
        });
        const execution = new ExecutionEngine({
          registry: new RunnerRegistry([new CommandRunner(), new NodeRunner()]),
          logger: options.logger,
        });
        const shared = { store, logger: options.logger, clock: systemClock };
        runtime = {
          config: { ok: true, snapshot },
          services: {
            capture: new CaptureService({ ...shared, execution, keelVersion: options.keelVersion }),
            check: new CheckService({
              ...shared,
              execution,
              treeDigest: options.treeDigest,
              classifier: new HeuristicClassifier(),
              codeDiff: options.codeDiff,
            }),
            report: new ReportService(shared),
            baselines: new BaselineAdminService(store),
            suppressions: new SuppressionService(store, systemClock),
          },
          git,
          parentEnv: options.env,
          keelVersion: options.keelVersion,
        };
      } catch (error) {
        if (error instanceof UserError && error.code === 'KEEL_E_CONFIG_INVALID') {
          // Uninitialized/misconfigured workspace: a graceful status answer, not a failure.
          runtime = {
            config: { ok: false, problem: error.message },
            git,
            parentEnv: options.env,
            keelVersion: options.keelVersion,
          };
        } else {
          throw error;
        }
      }
      return {
        runtime,
        release: async () => {
          await store?.close();
        },
      };
    },
  };

  const server = new McpServer({
    input: options.input,
    output: options.output,
    logger: options.logger,
    serverVersion: options.keelVersion,
    runtimeFactory: factory,
  });
  options.logger.info('mcp.session.start', { cwd: options.cwd });
  await server.run();
}
