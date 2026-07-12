/**
 * CLI argument parsing — pure and separately testable (adapter contains no
 * business logic, C26; Phase 0 surface is version/help only, Doc 24).
 */

export type CliCommand =
  | { readonly kind: 'version' }
  | { readonly kind: 'help' }
  | { readonly kind: 'unknown'; readonly input: string };

export const USAGE = `keel — local-first regression oracle for AI coding agents

Usage:
  keel --version    Print the keel version
  keel --help       Show this help

Phase 0 foundation build: engine commands (init, capture, check, report)
arrive in later phases. See ARCHITECTURE.md in the repository.
`;

export function parseArgs(argv: readonly string[]): CliCommand {
  const first = argv[0];
  if (first === undefined || first === '--help' || first === '-h') {
    return { kind: 'help' };
  }
  if (first === '--version' || first === '-v') {
    return { kind: 'version' };
  }
  return { kind: 'unknown', input: first };
}
