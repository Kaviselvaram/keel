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
