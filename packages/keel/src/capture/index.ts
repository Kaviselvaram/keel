/**
 * capture/ — the Capture Engine (Ring 1, Doc 20 §3). Public surface: the
 * pipeline, the Normalizer and ruleset, capture's consumer-owned ports.
 */

export { CaptureEngine } from './engine.js';
export type {
  CaptureEngineOptions,
  CaptureRequest,
  CaptureResult,
  CaptureProgress,
  CaptureGitInfo,
  ObjectSinkPort,
  DocumentSinkPort,
  BaselineSinkPort,
} from './engine.js';

export { normalizeExecution } from './normalizer.js';
export type { NormalizedExecution } from './normalizer.js';

export { BUILTIN_RULES, SECRET_RULES, VOLATILE_RULES, RULESET_VERSION, makeRule } from './rules.js';
export type { NormalizationRule } from './rules.js';

export { toProbeSpec, toExecutionRequest, requiredInterceptors } from './probe-plan.js';
export type { CaptureProbe } from './probe-plan.js';

export { firstJsonDifference, findFlappingPath } from './verification.js';
