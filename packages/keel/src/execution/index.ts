/**
 * execution/ — the Execution Engine (Ring 1). Public surface per Doc 20 §2.
 * The only module that spawns processes (C23).
 */

export { ExecutionEngine } from './engine.js';
export type { ExecutionResult, ExecuteOptions, ExitStatus, ExecutionEngineOptions } from './engine.js';

export { RunnerRegistry } from './registry.js';

export { CommandRunner, COMMAND_RUNNER_ID } from './runners/command.js';

export { detectPlatform, executionFingerprint } from './platform.js';
export type { PlatformInfo, ExecutionConditions } from './platform.js';

export { buildChildEnv } from './env.js';
export type { ChildEnvInput } from './env.js';

export { createWorkspace } from './workspace.js';
export type { Workspace, WorkspaceOptions } from './workspace.js';

export { scanManifest, diffManifests } from './manifest.js';
export type { Manifest, ManifestEntry, RawFsEvent } from './manifest.js';

export { toProbeSpec, toExecutionRequest, hookExecutionRequest, requiredInterceptors } from './probe-plan.js';
export type { ResolvedProbe } from './probe-plan.js';

export { currentEnvironmentFingerprint } from './platform.js';

export { NodeRunner, NODE_RUNNER_ID, DEFAULT_VIRTUAL_EPOCH_MS, deriveSeed } from './runners/node/node-runner.js';
export { NODE_INTERCEPTOR_VERSIONS, SIDE_CHANNEL_PROTOCOL_VERSION } from './runners/node/preload-source.js';
export { parseSideChannel, EMPTY_SIDE_CHANNEL } from './side-channel.js';
export type { SideChannelData, RawNetCall, InterceptorRuntimeReport } from './side-channel.js';
