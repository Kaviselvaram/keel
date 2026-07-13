/**
 * @keel/runner-sdk — the public contract for KEEL runner plugins
 * (Doc 20 §15). Dependency-free; never imports the keel package (C31).
 */

export { RUNNER_SDK_VERSION, PROTOCOL_VERSION } from './versions.js';

export { INTERCEPTOR_CAPABILITIES, negotiateCapabilities } from './capabilities.js';
export type {
  InterceptorCapability,
  SupportedPlatform,
  RunnerCapabilities,
  NegotiationResult,
  NegotiationSuccess,
  NegotiationFailure,
} from './capabilities.js';

export type {
  ExecutionRequest,
  ExecutionLimits,
  ExecutionMode,
  RawStdin,
  PlannedFile,
  SpawnPlan,
  RawExit,
  StreamName,
  StreamChunk,
} from './execution.js';

export type { Runner } from './runner.js';

export { runnerContractChecks, referenceRequest } from './contract-kit.js';
export type { ContractCheck } from './contract-kit.js';
