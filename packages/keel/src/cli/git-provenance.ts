/**
 * Git provenance + working-tree digest acquisition — composition-root wiring
 * (the ruling recorded in the Phase 4/5 reports: this bounded, read-only
 * `git` invocation lives at the composition root; the execution engine's
 * shadow-workspace model is deliberately wrong for repo-cwd commands).
 * Best-effort: a missing git binary or non-repo yields nulls, never a crash.
 */

import { execFile } from 'node:child_process';
import { hashBytes } from '../model/index.js';

const GIT_TIMEOUT_MS = 5_000;

function git(cwd: string, args: readonly string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      'git',
      args as string[],
      { cwd, timeout: GIT_TIMEOUT_MS, windowsHide: true },
      (error, stdout) => {
        resolve(error === null ? stdout.trim() : null);
      },
    );
  });
}

export interface GitProvenance {
  readonly commit: string | null;
  readonly dirty: boolean;
  readonly branch: string | null;
}

export async function acquireGitProvenance(cwd: string): Promise<GitProvenance> {
  const commit = await git(cwd, ['rev-parse', 'HEAD']);
  if (commit === null) return { commit: null, dirty: true, branch: null };
  const status = await git(cwd, ['status', '--porcelain']);
  const branch = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return {
    commit,
    dirty: status === null || status.length > 0,
    branch: branch === null || branch === 'HEAD' ? null : branch,
  };
}

/** ADR-013 tree digest: hash of HEAD plus porcelain status; null outside a repo. */
export async function treeDigest(cwd: string): Promise<string | null> {
  const commit = await git(cwd, ['rev-parse', 'HEAD']);
  if (commit === null) return null;
  const status = await git(cwd, ['status', '--porcelain']);
  return hashBytes(new TextEncoder().encode(`${commit}\n${status ?? ''}`));
}
