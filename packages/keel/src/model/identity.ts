/**
 * Identity value formats — Doc 04 (ULID entity ids, SHA-256 content hashes).
 *
 * The model owns the *formats* and their validation; id *generation* lives
 * in shared/ (model is pure and imports no generator). The ULID pattern is
 * intentionally duplicated from shared/ids.ts: C21 forbids the import, and
 * the format is frozen, so drift is prevented by tests rather than sharing.
 */

import { ValidationError } from './errors.js';

/** Crockford base32, 26 chars — ULID text form. */
const ENTITY_ID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** Lowercase hex SHA-256. */
const CONTENT_HASH_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Probe names appear in file paths, divergence paths, and MCP payloads, so
 * the format is deliberately narrow. Frozen format: 1–128 chars, starts
 * alphanumeric, then alphanumerics plus `.`, `_`, `-`.
 */
const PROBE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export type EntityId = string;
export type ContentHash = string;
export type ProbeName = string;

export function isEntityId(value: string): boolean {
  return ENTITY_ID_PATTERN.test(value);
}

export function isContentHash(value: string): boolean {
  return CONTENT_HASH_PATTERN.test(value);
}

export function isProbeName(value: string): boolean {
  return PROBE_NAME_PATTERN.test(value);
}

export function assertEntityId(value: string, field: string): EntityId {
  if (!isEntityId(value)) {
    throw new ValidationError(`${field} is not a valid entity id (ULID)`, 'KEEL_E_MODEL_INVALID_ID', {
      field,
      value,
    });
  }
  return value;
}

export function assertContentHash(value: string, field: string): ContentHash {
  if (!isContentHash(value)) {
    throw new ValidationError(
      `${field} is not a valid content hash (lowercase hex sha-256)`,
      'KEEL_E_MODEL_INVALID_HASH',
      { field, value },
    );
  }
  return value;
}

export function assertProbeName(value: string, field = 'probeName'): ProbeName {
  if (!isProbeName(value)) {
    throw new ValidationError(
      `${field} is not a valid probe name (1-128 chars: alphanumerics, '.', '_', '-')`,
      'KEEL_E_MODEL_INVALID_PROBE_NAME',
      { field, value },
    );
  }
  return value;
}
