import { describe, expect, it } from 'vitest';
import {
  EnvironmentError,
  EXIT_CODES,
  ExecutionFault,
  exitCodeForError,
  IntegrityError,
  InternalError,
  invariant,
  KeelError,
  UserError,
} from '../errors.js';

describe('error hierarchy', () => {
  it('every error class is a KeelError and an Error with name and code', () => {
    const errors = [
      new UserError('bad config', { code: 'KEEL_E_CONFIG_INVALID', remediation: 'fix keel.config.jsonc' }),
      new EnvironmentError('daemon down', { code: 'KEEL_E_INFERENCE_UNREACHABLE' }),
      new ExecutionFault('spawn failed', { code: 'KEEL_E_SPAWN' }),
      new IntegrityError('hash mismatch', { code: 'KEEL_E_CAS_CORRUPT' }),
      new InternalError('impossible state', { code: 'KEEL_E_INVARIANT_VIOLATION' }),
    ];
    for (const error of errors) {
      expect(error).toBeInstanceOf(KeelError);
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe(error.constructor.name);
      expect(error.code.startsWith('KEEL_E_')).toBe(true);
      expect(error.context).toEqual({});
    }
  });

  it('preserves context and cause chains', () => {
    const cause = new Error('root');
    const error = new EnvironmentError('disk full', {
      code: 'KEEL_E_DISK_FULL',
      context: { path: '/tmp/x' },
      cause,
    });
    expect(error.context).toEqual({ path: '/tmp/x' });
    expect(error.cause).toBe(cause);
  });

  it('UserError requires remediation and carries optional docsLink', () => {
    const error = new UserError('unknown probe', {
      code: 'KEEL_E_PROBE_UNKNOWN',
      remediation: 'list probes with `keel baseline ls`',
      docsLink: 'https://example.invalid/docs/probes',
    });
    expect(error.remediation).toContain('baseline ls');
    expect(error.docsLink).toBeDefined();
  });
});

describe('five-code exit contract (Doc 10 C2)', () => {
  it('is frozen', () => {
    expect(EXIT_CODES).toEqual({ clean: 0, diverged: 1, user: 2, environment: 3, internal: 4 });
    expect(Object.isFrozen(EXIT_CODES)).toBe(true);
  });

  it('maps user errors to 2, environment to 3, everything else to 4', () => {
    expect(
      exitCodeForError(new UserError('x', { code: 'KEEL_E_X', remediation: 'y' })),
    ).toBe(2);
    expect(exitCodeForError(new EnvironmentError('x', { code: 'KEEL_E_X' }))).toBe(3);
    expect(exitCodeForError(new ExecutionFault('x', { code: 'KEEL_E_X' }))).toBe(4);
    expect(exitCodeForError(new IntegrityError('x', { code: 'KEEL_E_X' }))).toBe(4);
    expect(exitCodeForError(new InternalError('x', { code: 'KEEL_E_X' }))).toBe(4);
    expect(exitCodeForError(new Error('untyped'))).toBe(4);
    expect(exitCodeForError('not even an error')).toBe(4);
  });
});

describe('invariant', () => {
  it('passes on truthy conditions', () => {
    expect(() => invariant(1 === 1, 'must hold')).not.toThrow();
  });

  it('throws InternalError with context on violation', () => {
    expect(() => invariant(false, 'broken', { detail: 42 })).toThrowError(InternalError);
    try {
      invariant(false, 'broken', { detail: 42 });
    } catch (error) {
      expect(error).toBeInstanceOf(InternalError);
      expect((error as InternalError).code).toBe('KEEL_E_INVARIANT_VIOLATION');
      expect((error as InternalError).context).toEqual({ detail: 42 });
    }
  });
});
