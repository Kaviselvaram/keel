/**
 * Logger port — Architecture v1.0, Doc 10 Part B and Doc 20 §10.
 *
 * Injected, never global (C62). Event names follow `module.action.outcome`
 * (Doc 23). Correlation: bind `opId` via child() at operation ingress (C63).
 */

export const LOG_LEVELS = ['error', 'warn', 'info', 'debug', 'trace'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export type LogFields = Readonly<Record<string, unknown>>;

export interface Logger {
  readonly level: LogLevel;
  log(level: LogLevel, event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  debug(event: string, fields?: LogFields): void;
  trace(event: string, fields?: LogFields): void;
  /** Returns a logger with additional bound fields (e.g. opId, probeName). */
  child(bindings: LogFields): Logger;
}

export function isLevelEnabled(configured: LogLevel, candidate: LogLevel): boolean {
  return LOG_LEVELS.indexOf(candidate) <= LOG_LEVELS.indexOf(configured);
}

/** For tests and for consumers that were constructed without logging. */
export const noopLogger: Logger = {
  level: 'error',
  log: () => undefined,
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
  trace: () => undefined,
  child: () => noopLogger,
};
