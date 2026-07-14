/**
 * replay/ — the Replay Engine (Ring 1, Doc 20 §4). Reconstructs baseline
 * conditions; never compares (diff's job), never persists (the caller's).
 */

export { ReplayEngine } from './engine.js';
export type {
  ReplayEngineOptions,
  ReplayRequest,
  ReplayOutcome,
  ReplayedProbe,
  ReplayNormalizer,
  ReplayNormalizedRun,
  SnapshotSourcePort,
} from './engine.js';

export { DEFAULT_REPLAY_POLICY, evaluateProvenance } from './policy.js';
export type { ReplayPolicy, PolicyLevel, ProvenanceField, CurrentConditions, ProvenanceEvaluation } from './policy.js';
