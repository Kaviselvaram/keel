import { describe, expect, it } from 'vitest';
import { parseArgs, USAGE } from '../args.js';

describe('parseArgs', () => {
  it('no arguments shows help', () => {
    expect(parseArgs([])).toEqual({ kind: 'help' });
  });

  it('recognizes version flags', () => {
    expect(parseArgs(['--version'])).toEqual({ kind: 'version' });
    expect(parseArgs(['-v'])).toEqual({ kind: 'version' });
  });

  it('recognizes help flags', () => {
    expect(parseArgs(['--help'])).toEqual({ kind: 'help' });
    expect(parseArgs(['-h'])).toEqual({ kind: 'help' });
  });

  it('anything else is unknown, preserving the input for the error message', () => {
    expect(parseArgs(['check'])).toEqual({ kind: 'unknown', input: 'check' });
  });

  it('usage names the tool and both flags', () => {
    expect(USAGE).toContain('keel');
    expect(USAGE).toContain('--version');
    expect(USAGE).toContain('--help');
  });
});
