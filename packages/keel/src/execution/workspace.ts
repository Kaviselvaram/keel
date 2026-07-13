/**
 * Shadow workspace (Doc 20 §2, C45): every execution runs in its own
 * temporary directory; the user's tree is never the child's cwd. What gets
 * materialized into the workspace is the caller's policy — the engine only
 * provides the boundary and its lifecycle.
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EnvironmentError, UserError } from '../shared/index.js';
import type { Logger } from '../observability/index.js';
import type { PlannedFile } from '@keel/runner-sdk';

export interface Workspace {
  readonly root: string;
  /** Resolves a workspace-relative POSIX path, refusing escapes. */
  resolve(relative: string): string;
  materialize(files: readonly PlannedFile[]): Promise<void>;
  cleanup(): Promise<void>;
}

export interface WorkspaceOptions {
  /** Parent directory for workspaces (default: OS temp dir). */
  readonly baseDir?: string;
  readonly logger: Logger;
}

function assertInside(root: string, relative: string): string {
  const resolved = path.resolve(root, relative.split('/').join(path.sep));
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new UserError(`path '${relative}' escapes the workspace`, {
      code: 'KEEL_E_EXEC_WORKSPACE_ESCAPE',
      remediation: 'use workspace-relative paths without .. segments',
      context: { relative },
    });
  }
  return resolved;
}

export async function createWorkspace(options: WorkspaceOptions): Promise<Workspace> {
  let root: string;
  try {
    root = await mkdtemp(path.join(options.baseDir ?? tmpdir(), 'keel-ws-'));
  } catch (cause) {
    throw new EnvironmentError('failed to create execution workspace', {
      code: 'KEEL_E_EXEC_WORKSPACE_CREATE',
      cause,
    });
  }
  let cleaned = false;

  return {
    root,
    resolve: (relative) => assertInside(root, relative),
    async materialize(files) {
      for (const file of files) {
        const target = assertInside(root, file.path);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, file.bytes);
      }
    },
    async cleanup() {
      if (cleaned) return;
      cleaned = true;
      try {
        await rm(root, { recursive: true, force: true, maxRetries: 3 });
      } catch (cause) {
        // Cleanup failure must not fail the execution result (best-effort,
        // Doc 20 §2) — but it is never silent.
        options.logger.warn('execution.workspace.cleanup-failed', {
          root,
          error: cause instanceof Error ? cause.message : String(cause),
        });
      }
    },
  };
}
