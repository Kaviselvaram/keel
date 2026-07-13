/**
 * Advisory store lock (Doc 20 §8: one writer per store).
 *
 * Mechanism: atomic O_CREAT|O_EXCL creation of `<store>/lock` containing the
 * holder's pid. Stale detection: if the recorded pid is not alive, the lock
 * is reclaimed. Deadlock prevention is structural — there is exactly one,
 * non-reentrant lock, so no ordering cycles can exist. SQLite WAL provides
 * concurrent-reader safety underneath; this lock serializes writers.
 *
 * Known limit (documented, accepted for v1): pid reuse can make a stale lock
 * look held; the timeout error names the pid so the user can judge.
 */

import { readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { EnvironmentError } from '../shared/index.js';
import type { Clock } from '../shared/index.js';
import type { Logger } from '../observability/index.js';

export interface StoreLock {
  readonly file: string;
  release(): Promise<void>;
}

export interface AcquireLockOptions {
  readonly directory: string;
  readonly timeoutMs: number;
  readonly logger: Logger;
  readonly clock: Clock;
}

interface LockContents {
  readonly pid: number;
  readonly acquiredAtEpochMs: number;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM = alive but not ours; ESRCH = gone.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function tryReclaimStale(file: string, logger: Logger): Promise<boolean> {
  let contents: LockContents;
  try {
    contents = JSON.parse(await readFile(file, 'utf8')) as LockContents;
  } catch {
    // Unreadable/partial lock file: treat as stale (its writer died mid-write).
    await unlink(file).catch(() => undefined);
    logger.warn('storage.lock.reclaimed-unreadable', { file });
    return true;
  }
  if (!isProcessAlive(contents.pid)) {
    await unlink(file).catch(() => undefined);
    logger.warn('storage.lock.reclaimed-stale', { file, deadPid: contents.pid });
    return true;
  }
  return false;
}

export async function acquireStoreLock(options: AcquireLockOptions): Promise<StoreLock> {
  const file = path.join(options.directory, 'lock');
  const deadline = options.clock.epochMillis() + options.timeoutMs;
  const contents: LockContents = {
    pid: process.pid,
    acquiredAtEpochMs: options.clock.epochMillis(),
  };

  for (;;) {
    try {
      await writeFile(file, JSON.stringify(contents), { flag: 'wx' });
      return {
        file,
        release: async () => {
          await unlink(file).catch(() => undefined);
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw new EnvironmentError('cannot create store lock file', {
          code: 'KEEL_E_STORE_LOCK_IO',
          context: { file },
          cause: error,
        });
      }
    }
    if (await tryReclaimStale(file, options.logger)) continue;
    if (options.clock.epochMillis() >= deadline) {
      let holder = 'unknown';
      try {
        holder = String((JSON.parse(await readFile(file, 'utf8')) as LockContents).pid);
      } catch {
        // Best-effort context only.
      }
      throw new EnvironmentError('store is locked by another process', {
        code: 'KEEL_E_STORE_LOCKED',
        context: { file, holderPid: holder, timeoutMs: options.timeoutMs },
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
