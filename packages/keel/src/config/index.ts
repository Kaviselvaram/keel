/**
 * config/ — Configuration (Ring 2, Doc 20 §9): the only module that reads
 * env vars or config files (C64). Everything downstream receives the frozen
 * ConfigSnapshot.
 */

export { resolveStoreDirectory } from './store-location.js';
export type { StoreLocationInput } from './store-location.js';

export { loadConfig } from './load.js';
export type { LoadConfigOptions } from './load.js';

export type {
  ConfigSnapshot,
  ProbeConfig,
  NormalizationRuleConfig,
  MachineConfig,
} from './schema.js';
