import { describe, expect, it } from 'vitest';
import { createAnnotation } from '../annotation.js';
import { ValidationError } from '../errors.js';
import { createProbeSpec, probeSpecHash } from '../probe.js';
import type { ProbeSpecInput } from '../probe.js';
import { absorbSuppression, createSuppression, expireSuppression } from '../suppression.js';
import { assertSupportedSchemaVersion } from '../versions.js';
import { HASH_A, ULID_A } from './fixtures.js';

const probeInput = (overrides: Partial<ProbeSpecInput> = {}): ProbeSpecInput => ({
  name: 'api-list-users',
  runner: 'command',
  captureMode: 'process',
  invocation: { command: 'node', args: ['server.js'], cwd: '.', stdin: { kind: 'none' }, envAllowlist: ['PATH'] },
  interception: { clock: 'virtual', rng: 'seeded', network: 'record' },
  limits: { timeoutMs: 30_000, maxOutputBytes: 1_048_576, maxFsEffectBytes: 1_048_576 },
  hooks: {},
  ignoreRules: [],
  serial: false,
  ...overrides,
});

describe('probe spec', () => {
  it('hashes identically for identical content, differently when hooks change (Doc 04)', () => {
    expect(probeSpecHash(createProbeSpec(probeInput()))).toBe(probeSpecHash(createProbeSpec(probeInput())));
    expect(probeSpecHash(createProbeSpec(probeInput({ hooks: { setup: 'seed-db.sh' } })))).not.toBe(
      probeSpecHash(createProbeSpec(probeInput())),
    );
  });

  it('validates name, runner, command, limits, and env uniqueness', () => {
    expect(() => createProbeSpec(probeInput({ name: 'bad name!' }))).toThrowError(ValidationError);
    expect(() => createProbeSpec(probeInput({ runner: '' }))).toThrowError(ValidationError);
    expect(() =>
      createProbeSpec(probeInput({ limits: { timeoutMs: 0, maxOutputBytes: 1, maxFsEffectBytes: 1 } })),
    ).toThrowError(ValidationError);
    expect(() =>
      createProbeSpec(
        probeInput({
          invocation: { command: 'x', args: [], cwd: '.', stdin: { kind: 'none' }, envAllowlist: ['PATH', 'PATH'] },
        }),
      ),
    ).toThrowError(ValidationError);
  });
});

describe('annotation', () => {
  const base = {
    divergenceStableId: HASH_A,
    label: 'uncertain' as const,
    confidence: 0,
    attribution: { tier: 'none', reason: 'inference-unavailable' } as const,
    rationale: 'no local model available',
    evidencePacketHash: null,
  };

  it("tier 'none' must be uncertain and evidence-free (C55)", () => {
    expect(createAnnotation(base).label).toBe('uncertain');
    expect(() => createAnnotation({ ...base, label: 'intended' })).toThrowError(ValidationError);
    expect(() => createAnnotation({ ...base, evidencePacketHash: HASH_A })).toThrowError(ValidationError);
  });

  it('bounds confidence to [0,1]', () => {
    expect(() => createAnnotation({ ...base, confidence: 1.2 })).toThrowError(ValidationError);
    expect(() => createAnnotation({ ...base, confidence: -0.1 })).toThrowError(ValidationError);
  });
});

describe('suppression lifecycle (ADR-014)', () => {
  const active = () =>
    createSuppression({
      id: ULID_A,
      target: { kind: 'stable-id', stableId: HASH_A },
      reason: 'accepted price format change',
      createdBy: 'mcp',
      createdAtEpochMs: 1_000,
    });

  it('active -> absorbed and active -> expired; never from terminal states', () => {
    expect(absorbSuppression(active()).status).toBe('absorbed');
    expect(expireSuppression(active()).status).toBe('expired');
    expect(() => absorbSuppression(absorbSuppression(active()))).toThrowError(ValidationError);
    expect(() => expireSuppression(absorbSuppression(active()))).toThrowError(ValidationError);
  });

  it('validates reason, pattern, and expiry ordering', () => {
    expect(() =>
      createSuppression({ ...{ id: ULID_A, target: { kind: 'pattern', pattern: '' }, reason: 'x', createdBy: 'cli' as const, createdAtEpochMs: 1 } }),
    ).toThrowError(ValidationError);
    expect(() =>
      createSuppression({ id: ULID_A, target: { kind: 'stable-id', stableId: HASH_A }, reason: '  ', createdBy: 'cli', createdAtEpochMs: 1 }),
    ).toThrowError(ValidationError);
    expect(() =>
      createSuppression({ id: ULID_A, target: { kind: 'stable-id', stableId: HASH_A }, reason: 'x', createdBy: 'cli', createdAtEpochMs: 10, expiryEpochMs: 5 }),
    ).toThrowError(ValidationError);
  });
});

describe('schema version gate (C34)', () => {
  it('accepts the current major and rejects unknown ones', () => {
    expect(() => assertSupportedSchemaVersion(1)).not.toThrow();
    expect(() => assertSupportedSchemaVersion(2)).toThrowError(ValidationError);
    expect(() => assertSupportedSchemaVersion(0)).toThrowError(ValidationError);
  });
});
