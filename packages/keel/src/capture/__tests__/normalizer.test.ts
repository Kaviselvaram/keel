import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ExecutionResult } from '../../execution/index.js';
import { hashBytes } from '../../model/index.js';
import { normalizeExecution } from '../normalizer.js';
import { BUILTIN_RULES } from '../rules.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function syntheticResult(stdout: Uint8Array, stderr = new Uint8Array()): ExecutionResult {
  return {
    exit: { kind: 'exited', code: 0 },
    stdout,
    stderr,
    stdoutTruncated: false,
    stderrTruncated: false,
    fsEvents: [],
    fsBudgetExceeded: false,
    conditions: {
      platform: { os: 'linux', arch: 'x64', runtimeName: 'node', runtimeVersion: '22.0.0' },
      runnerId: 'command',
      runnerVersion: '0.1.0',
      armedInterceptors: {},
    },
    fingerprint: 'a'.repeat(64),
    armedInterceptors: {},
    startedAtEpochMs: 0,
    durationMs: 0,
  };
}

function stdoutPayload(result: ReturnType<typeof normalizeExecution>): string {
  const stream = result.observations.find(
    (observation) => observation.kind === 'stream' && observation.stream === 'stdout',
  );
  if (stream === undefined || stream.kind !== 'stream') throw new Error('no stdout observation');
  return decoder.decode(result.payloads.get(stream.contentHash));
}

describe('normalizer (ruleset v1)', () => {
  it('sniffs JSON and re-serializes canonically (key order vanishes)', () => {
    const a = normalizeExecution(syntheticResult(encoder.encode('{"b":2,"a":1}')), BUILTIN_RULES);
    const b = normalizeExecution(syntheticResult(encoder.encode('{ "a": 1, "b": 2 }')), BUILTIN_RULES);
    expect(stdoutPayload(a)).toBe('{"a":1,"b":2}');
    expect(stdoutPayload(a)).toBe(stdoutPayload(b));
    const stream = a.observations.find((observation) => observation.kind === 'stream');
    expect(stream?.kind === 'stream' && stream.interpretation).toBe('json');
  });

  it('scrubs volatile values inside JSON and plain text', () => {
    const json = normalizeExecution(
      syntheticResult(
        encoder.encode('{"at":"2026-07-14T10:30:00.123Z","id":"123e4567-e89b-42d3-a456-426614174000","p":"0xdeadbeef01"}'),
      ),
      BUILTIN_RULES,
    );
    expect(stdoutPayload(json)).toBe(
      '{"at":"«keel:timestamp»","id":"«keel:uuid»","p":"«keel:address»"}',
    );
    const text = normalizeExecution(
      syntheticResult(encoder.encode('written to /tmp/keel-ws-abc123/out.txt at 2026-07-14T10:30:00Z')),
      BUILTIN_RULES,
    );
    expect(stdoutPayload(text)).toBe('written to «keel:temp-path» at «keel:timestamp»');
    expect(text.secretFindings).toEqual([]);
  });

  it('scrubs secrets AND flags them (Doc 24 P4 acceptance), never echoing the value', () => {
    const key = `AKIA${'ABCDEFGH'.repeat(2)}`;
    const result = normalizeExecution(
      syntheticResult(encoder.encode(`{"aws":"${key}","note":"Bearer abcdef0123456789TOKEN"}`)),
      BUILTIN_RULES,
    );
    expect(result.secretFindings).toEqual(['aws-access-key', 'bearer-token']);
    const payload = stdoutPayload(result);
    expect(payload).toContain('«keel:secret»');
    expect(payload).not.toContain('AKIA');
    expect(JSON.stringify(result.secretFindings)).not.toContain('AKIA');
  });

  it('passes binary streams through untouched', () => {
    const binary = new Uint8Array([0x00, 0xff, 0xfe, 0x00, 0x41]);
    const result = normalizeExecution(syntheticResult(binary), BUILTIN_RULES);
    const stream = result.observations.find((observation) => observation.kind === 'stream');
    expect(stream?.kind === 'stream' && stream.interpretation).toBe('binary');
    expect(result.payloads.get(stream?.kind === 'stream' ? stream.contentHash : '')).toEqual(binary);
  });

  it('normalizes CRLF in text so platforms compare equal', () => {
    const unix = normalizeExecution(syntheticResult(encoder.encode('one\ntwo\n')), BUILTIN_RULES);
    const windows = normalizeExecution(syntheticResult(encoder.encode('one\r\ntwo\r\n')), BUILTIN_RULES);
    expect(stdoutPayload(unix)).toBe(stdoutPayload(windows));
  });

  it('produces canonically ordered observations including fs effects', () => {
    const result = normalizeExecution(
      {
        ...syntheticResult(encoder.encode('x')),
        fsEvents: [
          { path: 'b.txt', change: 'created', hash: 'b'.repeat(64), size: 1 },
          { path: 'a.txt', change: 'deleted' },
        ],
      },
      BUILTIN_RULES,
    );
    expect(result.observations.map((observation) => observation.kind)).toEqual([
      'exit',
      'stream',
      'stream',
      'fs-effect',
      'fs-effect',
    ]);
    const effects = result.observations.filter((observation) => observation.kind === 'fs-effect');
    expect(effects[0]?.kind === 'fs-effect' && effects[0].path).toBe('a.txt');
  });
});

describe('normalization properties', () => {
  it('is idempotent: normalizing a normalized payload is a fixed point (Doc 24 P4)', () => {
    fc.assert(
      fc.property(fc.oneof(fc.jsonValue(), fc.string()), (value) => {
        const original = typeof value === 'string' ? value : JSON.stringify(value);
        const once = normalizeExecution(syntheticResult(encoder.encode(original)), BUILTIN_RULES);
        const onceStdout = once.observations.find(
          (observation) => observation.kind === 'stream' && observation.stream === 'stdout',
        );
        if (onceStdout?.kind !== 'stream') return;
        const oncePayload = once.payloads.get(onceStdout.contentHash) as Uint8Array;
        const twice = normalizeExecution(syntheticResult(oncePayload), BUILTIN_RULES);
        const twiceStdout = twice.observations.find(
          (observation) => observation.kind === 'stream' && observation.stream === 'stdout',
        );
        expect(twiceStdout?.kind === 'stream' && twiceStdout.contentHash).toBe(onceStdout.contentHash);
      }),
      { numRuns: 200 },
    );
  });

  it('is deterministic: identical raw results produce identical observation sets', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 512 }), (bytes) => {
        const first = normalizeExecution(syntheticResult(bytes), BUILTIN_RULES);
        const second = normalizeExecution(syntheticResult(new Uint8Array(bytes)), BUILTIN_RULES);
        expect(first.observations).toEqual(second.observations);
      }),
      { numRuns: 100 },
    );
  });

  it('replacement tokens can never re-match any rule (self-stability)', () => {
    for (const rule of BUILTIN_RULES) {
      for (const other of BUILTIN_RULES) {
        other.pattern.lastIndex = 0;
        expect(other.pattern.test(rule.replacement)).toBe(false);
        other.pattern.lastIndex = 0;
      }
    }
    expect(hashBytes(encoder.encode('«keel:secret»'))).toBeDefined();
  });
});
