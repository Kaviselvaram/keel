/**
 * Store-location resolution — the single Phase 3 config concern the playbook
 * allows here (Doc 24 P3). Full configuration arrives in Phase 4; this file
 * establishes the rule that env access happens only in config/ (C64):
 * callers inject the environment at composition roots.
 *
 * Resolution (ADR-012, Doc 08): KEEL_STORE_DIR override, else
 * `<worktree-root>/.keel`. The path never participates in any content hash.
 */

import path from 'node:path';

export interface StoreLocationInput {
  /** The worktree root (usually process.cwd() at the composition root). */
  readonly cwd: string;
  /** Injected environment (process.env at the composition root). */
  readonly env: Readonly<Record<string, string | undefined>>;
}

export function resolveStoreDirectory(input: StoreLocationInput): string {
  const override = input.env['KEEL_STORE_DIR'];
  if (override !== undefined && override.length > 0) {
    return path.resolve(input.cwd, override);
  }
  return path.resolve(input.cwd, '.keel');
}
