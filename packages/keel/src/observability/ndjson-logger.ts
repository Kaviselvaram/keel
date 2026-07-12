/**
 * NDJSON structured logger — Architecture v1.0, Doc 10 Part B.
 *
 * Skeleton for Phase 0: writes one JSON object per line to an injected sink.
 * File rotation and redaction rules arrive with the modules that need them.
 *
 * Contract: logging failures never propagate (Doc 20 §10) — a broken sink or
 * an unserializable field degrades the line, never the caller.
 */

import type { Clock } from '../shared/index.js';
import { systemClock } from '../shared/index.js';
import type { LogFields, Logger, LogLevel } from './logger.js';
import { isLevelEnabled } from './logger.js';

export interface LineSink {
  write(line: string): void;
}

export interface NdjsonLoggerOptions {
  readonly sink: LineSink;
  readonly level?: LogLevel;
  readonly clock?: Clock;
  readonly bindings?: LogFields;
}

function serializeLine(
  timestamp: string,
  level: LogLevel,
  event: string,
  bindings: LogFields,
  fields: LogFields | undefined,
): string {
  const record = { ts: timestamp, level, event, ...bindings, ...fields };
  try {
    return JSON.stringify(record);
  } catch {
    // Unserializable field (circular reference, etc.) — keep the event, drop the payload.
    return JSON.stringify({
      ts: timestamp,
      level,
      event,
      keelLogError: 'fields-unserializable',
    });
  }
}

export function createNdjsonLogger(options: NdjsonLoggerOptions): Logger {
  const level = options.level ?? 'info';
  const clock = options.clock ?? systemClock;
  const bindings = options.bindings ?? {};

  const log = (candidate: LogLevel, event: string, fields?: LogFields): void => {
    if (!isLevelEnabled(level, candidate)) return;
    const line = serializeLine(clock.now().toISOString(), candidate, event, bindings, fields);
    try {
      options.sink.write(`${line}\n`);
    } catch {
      // C-contract: logging never propagates.
    }
  };

  return {
    level,
    log,
    error: (event, fields) => log('error', event, fields),
    warn: (event, fields) => log('warn', event, fields),
    info: (event, fields) => log('info', event, fields),
    debug: (event, fields) => log('debug', event, fields),
    trace: (event, fields) => log('trace', event, fields),
    child: (childBindings) =>
      createNdjsonLogger({
        sink: options.sink,
        level,
        clock,
        bindings: { ...bindings, ...childBindings },
      }),
  };
}
