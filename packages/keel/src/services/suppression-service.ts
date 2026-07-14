/**
 * SuppressionService — the `keel_suppress` use case (Doc 09 §3; a new use
 * case, the extension Doc 20 §11 sanctions). Append-only and reasoned:
 * suppressions filter presentation and CI exit semantics, never facts
 * (Doc 04); lifecycle per ADR-014.
 */

import { UserError, ulid } from '../shared/index.js';
import type { Clock } from '../shared/index.js';
import { createSuppression, isContentHash } from '../model/index.js';
import type { Suppression } from '../model/index.js';
import type { KeelStore } from '../storage/index.js';

export interface SuppressCommand {
  readonly stableId?: string;
  readonly pattern?: string;
  readonly reason: string;
  readonly createdBy: 'cli' | 'mcp';
  readonly expiresInDays?: number;
}

export class SuppressionService {
  private readonly store: KeelStore;
  private readonly clock: Clock;

  constructor(store: KeelStore, clock: Clock) {
    this.store = store;
    this.clock = clock;
  }

  async suppress(command: SuppressCommand): Promise<Suppression> {
    if ((command.stableId === undefined) === (command.pattern === undefined)) {
      throw new UserError('exactly one of stableId or pattern is required', {
        code: 'KEEL_E_SUPPRESS_TARGET',
        remediation: 'pass the stableId from a keel_check divergence, or a path glob pattern',
      });
    }
    if (command.stableId !== undefined && !isContentHash(command.stableId)) {
      throw new UserError('stableId is not a divergence stable id', {
        code: 'KEEL_E_SUPPRESS_TARGET',
        remediation: 'copy the 64-hex stableId from a keel_check result',
        context: { stableId: command.stableId },
      });
    }
    const now = this.clock.epochMillis();
    const suppression = createSuppression({
      id: ulid(),
      target:
        command.stableId !== undefined
          ? { kind: 'stable-id', stableId: command.stableId }
          : { kind: 'pattern', pattern: command.pattern as string },
      reason: command.reason,
      createdBy: command.createdBy,
      createdAtEpochMs: now,
      ...(command.expiresInDays === undefined
        ? {}
        : { expiryEpochMs: now + Math.round(command.expiresInDays * 86_400_000) }),
    });
    await this.store.suppressions.save(suppression);
    return suppression;
  }
}
