/**
 * config/ — Configuration (Ring 2). Phase 3 ships only store-location
 * resolution; the full layered system (JSONC, hierarchy, ConfigSnapshot,
 * behavior hash) is Phase 4 per Doc 24.
 */

export { resolveStoreDirectory } from './store-location.js';
export type { StoreLocationInput } from './store-location.js';
