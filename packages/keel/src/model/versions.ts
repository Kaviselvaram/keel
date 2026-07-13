/**
 * Version anchors for everything the Behavior Model persists — Doc 20 §1.
 *
 * Rule (C34): readers reject unknown majors and tolerate unknown optional
 * fields. These constants are the single place version numbers live.
 */

import { ValidationError } from './errors.js';

/** Schema version stamped on every persisted entity (Doc 04). */
export const MODEL_SCHEMA_VERSION = 1;

/** Version of the canonical serialization rules (Doc 06 A3). Bumping this invalidates golden files deliberately. */
export const CANONICAL_FORM_VERSION = 1;

/** Content-address algorithm identifier (ADR-003 layout; Doc 04). */
export const HASH_ALGORITHM = 'sha-256';

/** Combined hash-format identifier persisted in provenance-sensitive contexts. */
export const HASH_VERSION = `${HASH_ALGORITHM}/1`;

/** Accepts the schema versions this build can read (current major only, plus documented N-1 once one exists). */
export const SUPPORTED_SCHEMA_VERSIONS: readonly number[] = [MODEL_SCHEMA_VERSION];

export function assertSupportedSchemaVersion(version: number): void {
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(version)) {
    throw new ValidationError(
      `unsupported schema version ${String(version)}`,
      'KEEL_E_MODEL_SCHEMA_UNSUPPORTED',
      { version, supported: [...SUPPORTED_SCHEMA_VERSIONS] },
    );
  }
}
