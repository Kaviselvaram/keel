/**
 * Suppression — "this divergence is accepted" (Doc 04, ADR-014).
 * Filters verdict presentation, never facts. Lifecycle:
 * active → absorbed (change became baseline at re-capture) | expired.
 * Never deleted (audit trail); an absorbed suppression cannot mask a
 * future divergence at the same path.
 */

import { deepFreeze } from './freeze.js';
import { ValidationError } from './errors.js';
import type { ContentHash, EntityId } from './identity.js';
import { assertContentHash as assertHashFormat, assertEntityId } from './identity.js';
import { MODEL_SCHEMA_VERSION } from './versions.js';

export type SuppressionTarget =
  | { readonly kind: 'stable-id'; readonly stableId: ContentHash }
  | { readonly kind: 'pattern'; readonly pattern: string };

export type SuppressionStatus = 'active' | 'absorbed' | 'expired';

export interface Suppression {
  readonly schemaVersion: typeof MODEL_SCHEMA_VERSION;
  readonly id: EntityId;
  readonly target: SuppressionTarget;
  readonly reason: string;
  readonly createdBy: 'cli' | 'mcp';
  readonly createdAtEpochMs: number;
  readonly expiryEpochMs: number | null;
  readonly status: SuppressionStatus;
}

export interface SuppressionInput {
  readonly id: EntityId;
  readonly target: SuppressionTarget;
  readonly reason: string;
  readonly createdBy: 'cli' | 'mcp';
  readonly createdAtEpochMs: number;
  readonly expiryEpochMs?: number;
}

export function createSuppression(input: SuppressionInput): Suppression {
  assertEntityId(input.id, 'suppression.id');
  if (input.reason.trim().length === 0) {
    throw new ValidationError('suppression reason must be non-empty', 'KEEL_E_MODEL_INVALID_SUPPRESSION', {
      id: input.id,
    });
  }
  if (input.target.kind === 'stable-id') {
    assertHashFormat(input.target.stableId, 'target.stableId');
  } else if (input.target.pattern.length === 0) {
    throw new ValidationError('suppression pattern must be non-empty', 'KEEL_E_MODEL_INVALID_SUPPRESSION', {
      id: input.id,
    });
  }
  if (input.expiryEpochMs !== undefined && input.expiryEpochMs <= input.createdAtEpochMs) {
    throw new ValidationError('expiry must be after creation', 'KEEL_E_MODEL_INVALID_SUPPRESSION', {
      id: input.id,
    });
  }
  return deepFreeze({
    schemaVersion: MODEL_SCHEMA_VERSION,
    id: input.id,
    target: input.target,
    reason: input.reason,
    createdBy: input.createdBy,
    createdAtEpochMs: input.createdAtEpochMs,
    expiryEpochMs: input.expiryEpochMs ?? null,
    status: 'active' as const,
  });
}

function transition(suppression: Suppression, to: SuppressionStatus): Suppression {
  if (suppression.status !== 'active') {
    throw new ValidationError(
      `cannot transition a ${suppression.status} suppression to ${to}`,
      'KEEL_E_MODEL_INVALID_TRANSITION',
      { id: suppression.id, from: suppression.status, to },
    );
  }
  return deepFreeze({ ...suppression, status: to });
}

/** active → absorbed (ADR-014: the accepted change is now the baseline). */
export function absorbSuppression(suppression: Suppression): Suppression {
  return transition(suppression, 'absorbed');
}

/** active → expired. */
export function expireSuppression(suppression: Suppression): Suppression {
  return transition(suppression, 'expired');
}
