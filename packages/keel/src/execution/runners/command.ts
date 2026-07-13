/**
 * The built-in `command` runner (Doc 05 §1): runs anything at the process
 * boundary. Interception capabilities: none — deliberately (a capability
 * that exists on two of three tier-1 platforms is a determinism lie);
 * normalization rules carry the load for non-instrumented runtimes.
 */

import type { ExecutionRequest, Runner, RunnerCapabilities, SpawnPlan } from '@keel/runner-sdk';
import { PROTOCOL_VERSION } from '@keel/runner-sdk';

export const COMMAND_RUNNER_ID = 'command';

export class CommandRunner implements Runner {
  capabilities(): RunnerCapabilities {
    return {
      runnerId: COMMAND_RUNNER_ID,
      runnerVersion: '0.1.0',
      protocolVersion: PROTOCOL_VERSION,
      platforms: ['linux', 'darwin', 'win32'],
      interceptors: {},
    };
  }

  plan(request: ExecutionRequest): SpawnPlan {
    if (request.interceptors.length > 0) {
      // Refuse, never silently ignore (contract kit check 7).
      throw new Error(
        `command runner offers no interceptors; required: ${request.interceptors.join(', ')}`,
      );
    }
    return {
      argv: [request.command, ...request.args],
      cwd: request.cwd,
      env: request.env,
      stdin: request.stdin,
      files: [],
      armedInterceptors: {},
    };
  }
}
