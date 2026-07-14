/**
 * BaselineAdminService (Doc 20 §11): baseline listing and removal for the
 * `keel baseline` commands. Removal deletes index rows only — objects become
 * GC-collectable garbage (C39: reclamation stays explicit).
 */

import { UserError } from '../shared/index.js';
import type { EntityId } from '../model/index.js';
import type { BaselineSummary, KeelStore } from '../storage/index.js';

export class BaselineAdminService {
  private readonly store: KeelStore;

  constructor(store: KeelStore) {
    this.store = store;
  }

  list(): readonly BaselineSummary[] {
    return this.store.baselines.list();
  }

  remove(id: EntityId): void {
    if (!this.store.baselines.remove(id)) {
      throw new UserError(`baseline '${id}' not found`, {
        code: 'KEEL_E_BASELINE_NOT_FOUND',
        remediation: "list baselines with 'keel baseline ls'",
        context: { id },
      });
    }
  }
}
