/**
 * Domain errors owned by the Behavior Model.
 *
 * model/ cannot import shared/ (C21), so these are self-contained Error
 * subclasses carrying the same code convention (KEEL_E_MODEL_*). They mean
 * "a KEEL bug or corrupt input" — model never throws on valid data
 * (Doc 20 §1 failure boundary). Services translate them into the shared
 * hierarchy at module boundaries (C58).
 */

export type ModelErrorCode = `KEEL_E_MODEL_${string}`;

export abstract class ModelError extends Error {
  readonly code: ModelErrorCode;
  readonly context: Readonly<Record<string, unknown>>;

  constructor(
    message: string,
    code: ModelErrorCode,
    context?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.context = context ?? {};
  }
}

/** A value cannot be represented in canonical form (cycle, NaN, non-plain object, …). */
export class CanonicalizationError extends ModelError {}

/** Recomputed content hash does not match the recorded one — corrupt or forged content (C33). */
export class HashMismatchError extends ModelError {}

/**
 * Entity construction, reference, or state-transition violation:
 * invalid probe/snapshot/baseline shapes, duplicate identifiers, broken
 * ownership, illegal lifecycle transitions, dangling relationships.
 */
export class ValidationError extends ModelError {}
