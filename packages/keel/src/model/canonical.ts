/**
 * Canonical serialization — Doc 06 A3, Doc 20 §1. CANONICAL_FORM_VERSION 1.
 *
 * The rules, exhaustively (this comment is the specification; golden tests
 * freeze the bytes):
 *
 *  1. Output is JSON text; bytes are its UTF-8 encoding (L4: byte-identical
 *     across platforms — every rule below is fully specified by ECMA-262 or
 *     Unicode, never by the host).
 *  2. Strings (values AND object keys) are normalized to Unicode NFC before
 *     anything else, then emitted with JSON.stringify's escaping (control
 *     chars, quote, backslash, and lone surrogates escaped; everything else
 *     emitted raw and UTF-8 encoded).
 *  3. Object keys are sorted by UTF-16 code unit order *after* NFC
 *     normalization. Two distinct keys that normalize to the same NFC string
 *     are a CanonicalizationError (silent last-writer-wins would be
 *     nondeterministic input-order dependence).
 *  4. Object entries whose value is `undefined` are omitted (mirrors JSON);
 *     `undefined` inside arrays is an error (JSON.stringify would coerce to
 *     null — canonical form refuses the ambiguity).
 *  5. Numbers must be finite; -0 canonicalizes to 0. Formatting is
 *     ECMA-262 Number::toString (shortest round-trip) — fully specified,
 *     platform-independent.
 *  6. Only null, boolean, number, string, plain arrays, and plain objects
 *     (prototype Object.prototype or null) are representable. Date, Map,
 *     Set, RegExp, bigint, symbol, function, class instances: error — the
 *     caller converts explicitly; canonical form never guesses.
 *  7. Cycles are an error.
 */

import { CanonicalizationError } from './errors.js';

/** The value space canonical form accepts. */
export type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue | undefined };

const encoder = new TextEncoder();

function isPlainObject(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function serializeValue(value: unknown, path: string, seen: Set<object>): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number': {
      if (!Number.isFinite(value)) {
        throw new CanonicalizationError(
          `non-finite number at ${path}`,
          'KEEL_E_MODEL_CANONICAL_NONFINITE',
          { path },
        );
      }
      return JSON.stringify(Object.is(value, -0) ? 0 : value);
    }
    case 'string':
      return JSON.stringify(value.normalize('NFC'));
    case 'object':
      break;
    default:
      throw new CanonicalizationError(
        `unrepresentable ${typeof value} at ${path}`,
        'KEEL_E_MODEL_CANONICAL_UNREPRESENTABLE',
        { path, type: typeof value },
      );
  }

  const objectValue = value as object;
  if (seen.has(objectValue)) {
    throw new CanonicalizationError(`cycle at ${path}`, 'KEEL_E_MODEL_CANONICAL_CYCLE', { path });
  }
  seen.add(objectValue);
  try {
    if (Array.isArray(objectValue)) {
      const items = objectValue.map((item: unknown, index) => {
        if (item === undefined) {
          throw new CanonicalizationError(
            `undefined array element at ${path}[${String(index)}]`,
            'KEEL_E_MODEL_CANONICAL_UNDEFINED_ELEMENT',
            { path, index },
          );
        }
        return serializeValue(item, `${path}[${String(index)}]`, seen);
      });
      return `[${items.join(',')}]`;
    }

    if (!isPlainObject(objectValue)) {
      throw new CanonicalizationError(
        `non-plain object at ${path} — convert explicitly before canonicalizing`,
        'KEEL_E_MODEL_CANONICAL_NONPLAIN',
        { path },
      );
    }

    const record = objectValue as Record<string, unknown>;
    const normalizedKeys = new Map<string, string>();
    for (const key of Object.keys(record)) {
      if (record[key] === undefined) continue;
      const normalized = key.normalize('NFC');
      const existing = normalizedKeys.get(normalized);
      if (existing !== undefined && existing !== key) {
        throw new CanonicalizationError(
          `keys '${existing}' and '${key}' collide after NFC normalization at ${path}`,
          'KEEL_E_MODEL_CANONICAL_KEY_COLLISION',
          { path },
        );
      }
      normalizedKeys.set(normalized, key);
    }
    const entries = [...normalizedKeys.keys()]
      .sort()
      .map((normalized) => {
        const originalKey = normalizedKeys.get(normalized) as string;
        return `${JSON.stringify(normalized)}:${serializeValue(
          record[originalKey],
          `${path}.${normalized}`,
          seen,
        )}`;
      });
    return `{${entries.join(',')}}`;
  } finally {
    seen.delete(objectValue);
  }
}

/** Canonical JSON text of a value. Throws CanonicalizationError on unrepresentable input. */
export function canonicalSerialize(value: unknown): string {
  return serializeValue(value, '$', new Set());
}

/** Canonical UTF-8 bytes — the input to content hashing. */
export function canonicalBytes(value: unknown): Uint8Array {
  return encoder.encode(canonicalSerialize(value));
}
