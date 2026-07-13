/**
 * RunnerRegistry (Doc 20 §2): discovery and capability reporting. Runners
 * are injected at the composition root — the registry never loads code.
 */

import { EnvironmentError, invariant } from '../shared/index.js';
import type { Runner, RunnerCapabilities } from '@keel/runner-sdk';

export class RunnerRegistry {
  private readonly runners = new Map<string, Runner>();

  constructor(runners: readonly Runner[] = []) {
    for (const runner of runners) this.register(runner);
  }

  register(runner: Runner): void {
    const id = runner.capabilities().runnerId;
    invariant(!this.runners.has(id), `duplicate runner registration '${id}'`, { runnerId: id });
    this.runners.set(id, runner);
  }

  get(runnerId: string): Runner {
    const runner = this.runners.get(runnerId);
    if (runner === undefined) {
      throw new EnvironmentError(`runner '${runnerId}' is not available`, {
        code: 'KEEL_E_EXEC_RUNNER_MISSING',
        context: { runnerId, available: [...this.runners.keys()] },
      });
    }
    return runner;
  }

  list(): readonly RunnerCapabilities[] {
    return [...this.runners.values()].map((runner) => runner.capabilities());
  }
}
