/**
 * Normalization ruleset v1 — Doc 06 A3, Doc 20 §3.
 *
 * Rules are data (id + pattern + replacement token), deliberately
 * conservative: a false positive silently erases real behavior, a false
 * negative merely produces a capture-time rejection with a named path —
 * so v1 errs toward missing volatiles, never toward over-scrubbing.
 * The ruleset version participates in baseline provenance: changing rules
 * honestly invalidates baselines (Doc 20 §3).
 *
 * Replacement tokens use guillemets so no rule pattern can ever re-match
 * its own output (normalization idempotence, property-tested).
 */

export const RULESET_VERSION = 'rules/1';

export interface NormalizationRule {
  readonly id: string;
  readonly pattern: RegExp;
  readonly replacement: string;
  /** Secret rules additionally flag the capture (Doc 24 P4 acceptance). */
  readonly secret: boolean;
}

export function makeRule(id: string, pattern: string, replacement: string, secret = false): NormalizationRule {
  return { id, pattern: new RegExp(pattern, 'g'), replacement, secret };
}

/** Volatile-value scrubbers. */
export const VOLATILE_RULES: readonly NormalizationRule[] = [
  makeRule(
    'iso-timestamp',
    String.raw`\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})`,
    '«keel:timestamp»',
  ),
  makeRule(
    'uuid',
    String.raw`\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b`,
    '«keel:uuid»',
  ),
  makeRule('hex-address', String.raw`\b0x[0-9a-fA-F]{6,16}\b`, '«keel:address»'),
  makeRule(
    // POSIX and macOS temp trees plus Windows local temp — covers engine
    // workspace paths leaking into output (mkdtemp under the OS temp dir).
    'temp-path',
    String.raw`(?:/tmp/|/private/tmp/|/var/folders/|[A-Za-z]:\\Users\\[^\s"'\\]+\\AppData\\Local\\Temp\\)[^\s"']*`,
    '«keel:temp-path»',
  ),
];

/** Secret detectors: scrub AND flag (never persist, never log the value). */
export const SECRET_RULES: readonly NormalizationRule[] = [
  makeRule('aws-access-key', String.raw`\bAKIA[0-9A-Z]{16}\b`, '«keel:secret»', true),
  makeRule('github-token', String.raw`\bgh[pousr]_[A-Za-z0-9]{20,255}\b`, '«keel:secret»', true),
  makeRule('bearer-token', String.raw`\bBearer\s+[A-Za-z0-9._~+/=-]{16,512}`, '«keel:secret»', true),
  makeRule(
    'private-key-block',
    String.raw`-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----`,
    '«keel:secret»',
    true,
  ),
];

export const BUILTIN_RULES: readonly NormalizationRule[] = [...SECRET_RULES, ...VOLATILE_RULES];
