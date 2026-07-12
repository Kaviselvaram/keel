/**
 * Typed error hierarchy — Architecture v1.0, Doc 10 Part C.
 *
 * Contract (C58–C61): every error crossing a module boundary is a member of
 * this hierarchy, carries a stable machine code, and maps onto the frozen
 * five-code exit contract.
 */

export type KeelErrorCode = `KEEL_E_${string}`;

export type ErrorContext = Readonly<Record<string, unknown>>;

export interface KeelErrorOptions {
  readonly code: KeelErrorCode;
  readonly context?: ErrorContext;
  readonly cause?: unknown;
}

export abstract class KeelError extends Error {
  readonly code: KeelErrorCode;
  readonly context: ErrorContext;

  // `abstract` on the class already prevents direct instantiation.
  constructor(message: string, options: KeelErrorOptions) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = new.target.name;
    this.code = options.code;
    this.context = options.context ?? {};
  }
}

export interface UserErrorOptions extends KeelErrorOptions {
  /** C60: user errors must state exactly how to fix the problem. Mandatory. */
  readonly remediation: string;
  readonly docsLink?: string;
}

/** The user can fix this: bad config, unknown probe, missing runner. Exit 2. */
export class UserError extends KeelError {
  readonly remediation: string;
  readonly docsLink: string | undefined;

  constructor(message: string, options: UserErrorOptions) {
    super(message, options);
    this.remediation = options.remediation;
    this.docsLink = options.docsLink;
  }
}

/** The machine, not the user or KEEL, is at fault: daemon down, disk full, lock held. Exit 3. */
export class EnvironmentError extends KeelError {}

/**
 * Engine-level execution failure (spawn failure, injection failure).
 * Distinct by contract from user code failing, which is an observation, never an error (C42).
 */
export class ExecutionFault extends KeelError {}

/** Store corruption: hash mismatch, provenance conflict. Never auto-healed (Doc 10 C1). */
export class IntegrityError extends KeelError {}

/** Invariant violation — a KEEL bug. Fails fast and loudly (C59). */
export class InternalError extends KeelError {}

/** The frozen five-code exit contract (Doc 10 §C2, C61). */
export const EXIT_CODES = Object.freeze({
  clean: 0,
  diverged: 1,
  user: 2,
  environment: 3,
  internal: 4,
});

/**
 * Maps an error to the exit contract. ExecutionFault, IntegrityError, and
 * anything unrecognized are KEEL's responsibility, not the user's or the
 * environment's — they map to `internal`.
 */
export function exitCodeForError(error: unknown): number {
  if (error instanceof UserError) return EXIT_CODES.user;
  if (error instanceof EnvironmentError) return EXIT_CODES.environment;
  return EXIT_CODES.internal;
}

/** Asserts an invariant; violation throws InternalError (C59). */
export function invariant(
  condition: unknown,
  message: string,
  context?: ErrorContext,
): asserts condition {
  if (!condition) {
    throw new InternalError(message, {
      code: 'KEEL_E_INVARIANT_VIOLATION',
      ...(context === undefined ? {} : { context }),
    });
  }
}
