/**
 * Process lifecycle control (Doc 20 §2 internal responsibility) — the one
 * place in KEEL that spawns and kills (C23, C41).
 *
 * Kill semantics:
 *  - POSIX: children spawn detached as process-group leaders; polite kill is
 *    SIGTERM to the group (-pid), forced kill is SIGKILL to the group after
 *    the grace window.
 *  - Windows: process-tree termination via `taskkill /T /F` (ADR-017
 *    proposed: true Job Objects need a native addon, which the supply-chain
 *    budget forbids; tree-kill meets the no-orphans acceptance criterion).
 *    Windows has no graceful tree signal, so grace applies to POSIX only.
 *
 * Abort (C44): kill initiation is synchronous in the abort handler —
 * SIGTERM within the 100ms budget.
 *
 * Timeout / cancellation / output caps are DATA, not errors (C42/C43):
 * they resolve into the exit status's cause.
 */

import { spawn, spawnSync } from 'node:child_process';
import { ExecutionFault } from '../shared/index.js';
import type { Logger } from '../observability/index.js';
import type { RawStdin, StreamChunk } from '@keel/runner-sdk';

/** Why the engine killed the child (undefined = it exited on its own). */
export type KillCause = 'timeout' | 'cancelled' | 'output-limit';

export interface ControlledExit {
  readonly code: number | null;
  readonly signal: string | null;
  readonly killCause: KillCause | undefined;
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
}

export interface ControlledSpawnOptions {
  readonly argv: readonly [string, ...string[]];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly stdin: RawStdin;
  readonly timeoutMs: number;
  readonly graceMs: number;
  readonly maxOutputBytes: number;
  readonly signal: AbortSignal;
  readonly logger: Logger;
  /** Live streaming sink; chunks are forwarded before cap accounting cuts off. */
  readonly onChunk?: (chunk: StreamChunk) => void;
}

function killTreeWindows(pid: number, logger: Logger): void {
  const result = spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
  if (result.status !== 0) {
    // Non-zero usually means the tree already exited; record and move on.
    logger.debug('execution.kill.taskkill-nonzero', { pid, status: result.status });
  }
}

function killGroupPosix(pid: number, signal: NodeJS.Signals, logger: Logger): void {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      logger.debug('execution.kill.already-gone', { pid, signal });
    }
  }
}

/**
 * Spawns argv under full engine control and resolves when the process (and,
 * via group/tree kill, its descendants) is finished. Never rejects for child
 * misbehavior — only for engine-level spawn failure (ExecutionFault).
 */
export function controlledSpawn(options: ControlledSpawnOptions): Promise<ControlledExit> {
  return new Promise<ControlledExit>((resolve, reject) => {
    const isWindows = process.platform === 'win32';
    const [command, ...args] = options.argv;

    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: !isWindows,
      windowsHide: true,
    });

    let killCause: KillCause | undefined;
    let graceTimer: NodeJS.Timeout | undefined;
    const stdoutChunks: Uint8Array[] = [];
    const stderrChunks: Uint8Array[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTruncated = false;
    let stderrTruncated = false;

    const initiateKill = (cause: KillCause): void => {
      if (killCause !== undefined) return;
      killCause = cause;
      options.logger.debug('execution.kill.initiated', { cause, pid: child.pid });
      if (child.pid === undefined) return;
      if (isWindows) {
        killTreeWindows(child.pid, options.logger);
      } else {
        killGroupPosix(child.pid, 'SIGTERM', options.logger);
        graceTimer = setTimeout(() => {
          if (child.pid !== undefined) killGroupPosix(child.pid, 'SIGKILL', options.logger);
        }, options.graceMs);
        graceTimer.unref();
      }
    };

    const onAbort = (): void => {
      initiateKill('cancelled');
    };

    const timeoutTimer = setTimeout(() => initiateKill('timeout'), options.timeoutMs);
    timeoutTimer.unref();

    const settle = (fn: () => void): void => {
      clearTimeout(timeoutTimer);
      if (graceTimer !== undefined) clearTimeout(graceTimer);
      options.signal.removeEventListener('abort', onAbort);
      fn();
    };

    child.once('error', (cause) => {
      settle(() =>
        reject(
          new ExecutionFault(`failed to spawn '${command}'`, {
            code: 'KEEL_E_EXEC_SPAWN',
            context: { command },
            cause,
          }),
        ),
      );
    });

    const attachStream = (
      stream: NodeJS.ReadableStream,
      name: 'stdout' | 'stderr',
      sink: Uint8Array[],
    ): void => {
      stream.on('data', (data: Buffer) => {
        const chunk = new Uint8Array(data);
        options.onChunk?.({ stream: name, bytes: chunk });
        const total = stdoutBytes + stderrBytes;
        const remaining = options.maxOutputBytes - total;
        if (remaining <= 0) {
          if (name === 'stdout') stdoutTruncated = true;
          else stderrTruncated = true;
          initiateKill('output-limit');
          return;
        }
        const kept = chunk.byteLength <= remaining ? chunk : chunk.subarray(0, remaining);
        if (kept.byteLength < chunk.byteLength) {
          if (name === 'stdout') stdoutTruncated = true;
          else stderrTruncated = true;
          initiateKill('output-limit');
        }
        sink.push(kept);
        if (name === 'stdout') stdoutBytes += kept.byteLength;
        else stderrBytes += kept.byteLength;
      });
    };

    if (child.stdout) attachStream(child.stdout, 'stdout', stdoutChunks);
    if (child.stderr) attachStream(child.stderr, 'stderr', stderrChunks);

    if (child.stdin) {
      if (options.stdin.kind === 'bytes') {
        child.stdin.write(options.stdin.bytes);
      }
      child.stdin.end();
      // A child that exited already (or closed stdin) causes EPIPE — data, not a fault.
      child.stdin.on('error', () => undefined);
    }

    if (options.signal.aborted) {
      onAbort();
    } else {
      options.signal.addEventListener('abort', onAbort, { once: true });
    }

    child.once('close', (code, signal) => {
      settle(() => {
        const concat = (chunks: Uint8Array[], length: number): Uint8Array => {
          const merged = new Uint8Array(length);
          let offset = 0;
          for (const chunk of chunks) {
            merged.set(chunk, offset);
            offset += chunk.byteLength;
          }
          return merged;
        };
        resolve({
          code,
          signal,
          killCause,
          stdout: concat(stdoutChunks, stdoutBytes),
          stderr: concat(stderrChunks, stderrBytes),
          stdoutTruncated,
          stderrTruncated,
        });
      });
    });
  });
}
