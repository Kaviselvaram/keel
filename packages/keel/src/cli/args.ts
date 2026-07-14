/**
 * CLI argument parsing — pure and separately testable (C26: adapters hold no
 * business logic; this file only shapes argv into typed commands).
 * Surface is exactly the Doc 24 P5 command set; no extras.
 */

export type CliCommand =
  | { readonly kind: 'version' }
  | { readonly kind: 'help' }
  | { readonly kind: 'init' }
  | { readonly kind: 'capture'; readonly label?: string; readonly probes?: readonly string[] }
  | { readonly kind: 'check'; readonly baselineId?: string; readonly label?: string; readonly json: boolean }
  | { readonly kind: 'report'; readonly verdictId: string; readonly json: boolean }
  | { readonly kind: 'baseline-ls' }
  | { readonly kind: 'baseline-rm'; readonly id: string }
  | { readonly kind: 'invalid'; readonly message: string };

export const USAGE = `keel — local-first regression oracle for AI coding agents

Usage:
  keel init                      Create a starter keel.config.jsonc
  keel capture [--label <l>]     Capture and seal a baseline
               [--probe <name>]  (repeatable) restrict to named probes
  keel check   [--label <l>]     Replay + diff against the baseline
               [--baseline <id>] use an explicit baseline
               [--json]          machine-readable verdict report
  keel report  <verdict-id>      Re-project a persisted verdict
               [--json]
  keel baseline ls               List baselines
  keel baseline rm <id>          Remove a baseline (objects become GC-collectable)
  keel --version | --help

Exit codes: 0 clean · 1 diverged · 2 user/stale · 3 environment · 4 internal
`;

interface Parsed {
  readonly positionals: readonly string[];
  readonly flags: ReadonlyMap<string, string[] | true>;
  readonly error?: string;
}

const VALUE_FLAGS = new Set(['--label', '--probe', '--baseline']);
const BOOLEAN_FLAGS = new Set(['--json']);

function scan(argv: readonly string[]): Parsed {
  const positionals: string[] = [];
  const flags = new Map<string, string[] | true>();
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index] as string;
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    if (BOOLEAN_FLAGS.has(token)) {
      flags.set(token, true);
      continue;
    }
    if (VALUE_FLAGS.has(token)) {
      const value = argv[++index];
      if (value === undefined || value.startsWith('--')) {
        return { positionals, flags, error: `${token} requires a value` };
      }
      const existing = flags.get(token);
      flags.set(token, Array.isArray(existing) ? [...existing, value] : [value]);
      continue;
    }
    return { positionals, flags, error: `unknown flag '${token}'` };
  }
  return { positionals, flags };
}

const single = (flags: Parsed['flags'], name: string): string | undefined => {
  const value = flags.get(name);
  return Array.isArray(value) ? value[value.length - 1] : undefined;
};

export function parseCli(argv: readonly string[]): CliCommand {
  const first = argv[0];
  if (first === undefined || first === '--help' || first === '-h') return { kind: 'help' };
  if (first === '--version' || first === '-v') return { kind: 'version' };

  const { positionals, flags, error } = scan(argv);
  if (error !== undefined) return { kind: 'invalid', message: error };
  const [command, ...rest] = positionals;

  switch (command) {
    case 'init':
      return { kind: 'init' };
    case 'capture': {
      const probes = flags.get('--probe');
      return {
        kind: 'capture',
        ...(single(flags, '--label') === undefined ? {} : { label: single(flags, '--label') as string }),
        ...(Array.isArray(probes) ? { probes } : {}),
      };
    }
    case 'check':
      return {
        kind: 'check',
        json: flags.get('--json') === true,
        ...(single(flags, '--baseline') === undefined ? {} : { baselineId: single(flags, '--baseline') as string }),
        ...(single(flags, '--label') === undefined ? {} : { label: single(flags, '--label') as string }),
      };
    case 'report': {
      const verdictId = rest[0];
      if (verdictId === undefined) return { kind: 'invalid', message: 'report requires a verdict id' };
      return { kind: 'report', verdictId, json: flags.get('--json') === true };
    }
    case 'baseline': {
      if (rest[0] === 'ls') return { kind: 'baseline-ls' };
      if (rest[0] === 'rm') {
        const id = rest[1];
        if (id === undefined) return { kind: 'invalid', message: 'baseline rm requires an id' };
        return { kind: 'baseline-rm', id };
      }
      return { kind: 'invalid', message: `unknown baseline subcommand '${rest[0] ?? ''}'` };
    }
    default:
      return { kind: 'invalid', message: `unknown command '${command ?? ''}'` };
  }
}
