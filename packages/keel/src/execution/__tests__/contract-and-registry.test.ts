import { describe, expect, it } from 'vitest';
import { runnerContractChecks } from '@keel/runner-sdk';
import { EnvironmentError, InternalError } from '../../shared/index.js';
import { CommandRunner } from '../runners/command.js';
import { RunnerRegistry } from '../registry.js';

describe('CommandRunner satisfies the runner contract (C67)', () => {
  for (const check of runnerContractChecks(new CommandRunner())) {
    it(check.name, () => {
      check.run();
    });
  }
});

describe('RunnerRegistry', () => {
  it('registers, reports capabilities, and resolves', () => {
    const registry = new RunnerRegistry([new CommandRunner()]);
    expect(registry.list().map((caps) => caps.runnerId)).toEqual(['command']);
    expect(registry.get('command').capabilities().runnerId).toBe('command');
  });

  it('missing runner is an EnvironmentError with the available list', () => {
    const registry = new RunnerRegistry([new CommandRunner()]);
    try {
      registry.get('node');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EnvironmentError);
      expect((error as EnvironmentError).context['available']).toEqual(['command']);
    }
  });

  it('duplicate registration is a wiring bug (InternalError)', () => {
    const registry = new RunnerRegistry([new CommandRunner()]);
    expect(() => registry.register(new CommandRunner())).toThrowError(InternalError);
  });
});
