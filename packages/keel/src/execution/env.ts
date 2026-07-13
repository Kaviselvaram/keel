/**
 * Child environment construction (Doc 05, C18): allowlist only — the child
 * sees exactly what was granted, never the parent's full environment.
 * Pure function: the parent environment is a parameter, never read here.
 */

import { UserError } from '../shared/index.js';

/**
 * Always granted: without PATH the command cannot resolve, and on Windows
 * SystemRoot/COMSPEC absence breaks process creation in well-documented ways.
 * These are execution mechanics, not information leakage; everything else
 * requires an explicit allowlist entry.
 */
const IMPLICIT_ALLOWLIST: readonly string[] = ['PATH', 'SYSTEMROOT', 'SYSTEMDRIVE', 'COMSPEC', 'WINDIR', 'TEMP', 'TMP'];

export interface ChildEnvInput {
  /** The parent environment (injected — buildChildEnv never reads process.env). */
  readonly base: Readonly<Record<string, string | undefined>>;
  readonly allowlist: readonly string[];
  /** Engine/interceptor additions; win over inherited values. */
  readonly overrides: Readonly<Record<string, string>>;
}

/** Case-insensitive lookup for Windows env semantics; exact-case elsewhere is a subset of this. */
function findKey(base: Readonly<Record<string, string | undefined>>, name: string): string | undefined {
  if (base[name] !== undefined) return name;
  const lower = name.toLowerCase();
  return Object.keys(base).find((key) => key.toLowerCase() === lower);
}

export function buildChildEnv(input: ChildEnvInput): Record<string, string> {
  const child: Record<string, string> = {};
  const grant = (name: string): void => {
    const key = findKey(input.base, name);
    if (key !== undefined) {
      const value = input.base[key];
      if (value !== undefined) child[name] = value;
    }
  };
  for (const name of IMPLICIT_ALLOWLIST) grant(name);
  for (const name of input.allowlist) {
    if (name.length === 0 || name.includes('=')) {
      throw new UserError(`invalid environment allowlist entry '${name}'`, {
        code: 'KEEL_E_EXEC_ENV_ALLOWLIST_INVALID',
        remediation: 'allowlist entries are plain variable names, e.g. "DATABASE_URL"',
        context: { name },
      });
    }
    grant(name);
  }
  for (const [name, value] of Object.entries(input.overrides)) child[name] = value;
  return child;
}
