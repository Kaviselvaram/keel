/**
 * storage/ — the Persistence module (Ring 2). Public surface per Doc 20 §8:
 * the store lifecycle, repositories, object/document stores, integrity, GC.
 * SQLite and the on-disk layout are internal (C36).
 */

export { KeelStore } from './store.js';
export type { OpenStoreOptions } from './store.js';

export { ObjectStore } from './object-store.js';
export type { ObjectStat, PutResult, CrashSeams, ObjectStoreOptions } from './object-store.js';

export { DocumentStore } from './document-store.js';

export { SqliteBaselineRepository } from './repositories/baseline-repository.js';
export type { BaselineSummary } from './repositories/baseline-repository.js';

export { SqliteVerdictRepository } from './repositories/verdict-repository.js';
export type { VerdictSummary } from './repositories/verdict-repository.js';

export { SqliteSuppressionRepository } from './repositories/suppression-repository.js';

export { verifyStoreIntegrity } from './integrity.js';
export type { IntegrityReport } from './integrity.js';

export { computeReachable, collectGarbage } from './gc.js';
export type { GcReport } from './gc.js';

export type { Migration } from './migrations.js';
