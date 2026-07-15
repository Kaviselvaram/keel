import { describe, expect, it } from 'vitest';
import { parseCli, USAGE } from '../args.js';

describe('parseCli', () => {
  it('parses the frozen command surface and nothing else', () => {
    expect(parseCli([])).toEqual({ kind: 'help' });
    expect(parseCli(['--version'])).toEqual({ kind: 'version' });
    expect(parseCli(['init'])).toEqual({ kind: 'init' });
    expect(parseCli(['capture'])).toEqual({ kind: 'capture' });
    expect(parseCli(['capture', '--label', 'main', '--probe', 'a', '--probe', 'b'])).toEqual({
      kind: 'capture',
      label: 'main',
      probes: ['a', 'b'],
    });
    expect(parseCli(['check', '--json', '--baseline', 'B1'])).toEqual({
      kind: 'check',
      json: true,
      baselineId: 'B1',
    });
    expect(parseCli(['check'])).toEqual({ kind: 'check', json: false });
    expect(parseCli(['report', 'V1', '--json'])).toEqual({ kind: 'report', verdictId: 'V1', json: true });
    expect(parseCli(['baseline', 'ls'])).toEqual({ kind: 'baseline-ls' });
    expect(parseCli(['baseline', 'rm', 'B1'])).toEqual({ kind: 'baseline-rm', id: 'B1' });
  });

  it('parses suppress with exactly one target and optional expiry', () => {
    expect(parseCli(['suppress', '--stable-id', 'abc', '--reason', 'ok'])).toEqual({
      kind: 'suppress',
      stableId: 'abc',
      reason: 'ok',
    });
    expect(parseCli(['suppress', '--pattern', 'stream:*', '--reason', 'ok', '--expires-in-days', '7'])).toEqual({
      kind: 'suppress',
      pattern: 'stream:*',
      reason: 'ok',
      expiresInDays: 7,
    });
  });

  it('rejects invalid suppress invocations', () => {
    expect(parseCli(['suppress'])).toMatchObject({ kind: 'invalid', message: expect.stringContaining('--reason') });
    expect(parseCli(['suppress', '--reason', 'x'])).toMatchObject({
      kind: 'invalid',
      message: expect.stringContaining('exactly one'),
    });
    expect(parseCli(['suppress', '--stable-id', 'a', '--pattern', 'p', '--reason', 'x'])).toMatchObject({
      kind: 'invalid',
    });
    expect(parseCli(['suppress', '--stable-id', 'a', '--reason', 'x', '--expires-in-days', 'soon'])).toMatchObject({
      kind: 'invalid',
    });
  });

  it('rejects malformed input with actionable messages', () => {
    expect(parseCli(['fly'])).toMatchObject({ kind: 'invalid' });
    expect(parseCli(['capture', '--label'])).toMatchObject({ kind: 'invalid', message: expect.stringContaining('--label') });
    expect(parseCli(['check', '--verbose'])).toMatchObject({ kind: 'invalid', message: expect.stringContaining('--verbose') });
    expect(parseCli(['report'])).toMatchObject({ kind: 'invalid' });
    expect(parseCli(['baseline', 'rm'])).toMatchObject({ kind: 'invalid' });
    expect(parseCli(['baseline', 'prune'])).toMatchObject({ kind: 'invalid' });
  });

  it('usage documents every command and the exit contract', () => {
    for (const term of ['init', 'capture', 'check', 'report', 'baseline ls', 'baseline rm', 'Exit codes']) {
      expect(USAGE).toContain(term);
    }
  });
});
