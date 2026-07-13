/**
 * The Runner port (Doc 20 §2/§15) — the one boundary third parties build
 * against (C31: one-way; the SDK never imports keel).
 *
 * A Runner converts an ExecutionRequest into a SpawnPlan for its runtime:
 * command rewriting, preload injection, interceptor env. It never spawns,
 * never touches the filesystem, never opens sockets — `plan` must be pure.
 * The engine owns processes, workspaces, caps, and kill semantics, so every
 * plugin inherits correct platform behavior instead of reimplementing it.
 */

import type { RunnerCapabilities } from './capabilities.js';
import type { ExecutionRequest, SpawnPlan } from './execution.js';

export interface Runner {
  capabilities(): RunnerCapabilities;
  /**
   * Pure planning: same request → same plan (contract-kit-enforced).
   * Throwing means the request is unsatisfiable by this runner
   * (e.g. required interceptor not offered) — the engine translates.
   */
  plan(request: ExecutionRequest): SpawnPlan;
}
