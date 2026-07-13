/**
 * Deep immutability for constructed entities (C32; Doc 02 §9 rule 4).
 * Internal to model/ — constructors freeze what they return.
 */

export function deepFreeze<T>(value: T): T {
  if (value !== null && (typeof value === 'object' || typeof value === 'function')) {
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}
