/**
 * shared/ — leaf utilities (Architecture v1.0, Doc 20 §14).
 *
 * May be imported by every module except model/. Imports nothing (C28).
 * Growth rule: errors, ids, result, time only — additions need review sign-off.
 */

export {
  KeelError,
  UserError,
  EnvironmentError,
  ExecutionFault,
  IntegrityError,
  InternalError,
  EXIT_CODES,
  exitCodeForError,
  invariant,
} from './errors.js';
export type { KeelErrorCode, ErrorContext, KeelErrorOptions, UserErrorOptions } from './errors.js';

export { ok, err, isOk, isErr } from './result.js';
export type { Ok, Err, Result } from './result.js';

export { createUlidGenerator, ulid, isUlid } from './ids.js';
export type { UlidGenerator } from './ids.js';

export { systemClock } from './time.js';
export type { Clock } from './time.js';
