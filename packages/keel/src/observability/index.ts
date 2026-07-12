/**
 * observability/ — local-only logging and diagnostics (Doc 20 §10).
 * Depends on shared/ only. No telemetry exists (C14).
 */

export { LOG_LEVELS, isLevelEnabled, noopLogger } from './logger.js';
export type { Logger, LogLevel, LogFields } from './logger.js';

export { createNdjsonLogger } from './ndjson-logger.js';
export type { LineSink, NdjsonLoggerOptions } from './ndjson-logger.js';
