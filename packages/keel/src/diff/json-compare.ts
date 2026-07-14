/**
 * Deep JSON comparison (Doc 20 §5 internal): parsed stream trees → typed
 * leaf differences with JSONPath-ish locators.
 *
 * Array strategy (Doc 24 P5 "identity-keyed arrays"): when both sides are
 * arrays whose elements are all objects carrying a primitive `id`, elements
 * pair by id — a pure reordering of the same ids is a single
 * `order-changed`; otherwise elements pair by index. Kept deliberately
 * simple in v1; richer identity-key rules are a registered extension point
 * (Doc 20 §5).
 */

export type JsonDiffKind =
  | 'value-changed'
  | 'shape-changed'
  | 'entry-added'
  | 'entry-removed'
  | 'order-changed';

export interface JsonDifference {
  readonly locator: string;
  readonly kind: JsonDiffKind;
  /** Sides carry the differing values (hashed into refs by the engine). */
  readonly baselineValue?: unknown;
  readonly candidateValue?: unknown;
}

type Emit = (difference: JsonDifference) => void;

function jsonType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function identityKeys(value: readonly unknown[]): readonly (string | number)[] | undefined {
  const keys: (string | number)[] = [];
  for (const element of value) {
    if (element === null || typeof element !== 'object' || Array.isArray(element)) return undefined;
    const id = (element as Record<string, unknown>)['id'];
    if (typeof id !== 'string' && typeof id !== 'number') return undefined;
    keys.push(id);
  }
  return new Set(keys).size === keys.length ? keys : undefined;
}

function compareArrays(a: readonly unknown[], b: readonly unknown[], locator: string, emit: Emit): void {
  const idsA = identityKeys(a);
  const idsB = identityKeys(b);
  if (idsA !== undefined && idsB !== undefined) {
    const byIdB = new Map(idsB.map((id, index) => [id, b[index]]));
    const setA = new Set(idsA);
    let sharedOutOfOrder = false;
    const sharedInA = idsA.filter((id) => byIdB.has(id));
    const sharedInB = idsB.filter((id) => setA.has(id));
    if (sharedInA.length === sharedInB.length && sharedInA.some((id, i) => id !== sharedInB[i])) {
      sharedOutOfOrder = true;
    }
    if (sharedOutOfOrder) emit({ kind: 'order-changed', locator });
    idsA.forEach((id, index) => {
      const locatorById = `${locator}[id=${String(id)}]`;
      if (!byIdB.has(id)) emit({ kind: 'entry-removed', locator: locatorById, baselineValue: a[index] });
      else compareJson(a[index], byIdB.get(id), locatorById, emit);
    });
    for (const [index, id] of idsB.entries()) {
      if (!setA.has(id)) {
        emit({ kind: 'entry-added', locator: `${locator}[id=${String(id)}]`, candidateValue: b[index] });
      }
    }
    return;
  }
  const shared = Math.min(a.length, b.length);
  for (let index = 0; index < shared; index++) {
    compareJson(a[index], b[index], `${locator}[${String(index)}]`, emit);
  }
  for (let index = shared; index < a.length; index++) {
    emit({ kind: 'entry-removed', locator: `${locator}[${String(index)}]`, baselineValue: a[index] });
  }
  for (let index = shared; index < b.length; index++) {
    emit({ kind: 'entry-added', locator: `${locator}[${String(index)}]`, candidateValue: b[index] });
  }
}

/** Emits typed leaf differences between two parsed JSON documents. */
export function compareJson(a: unknown, b: unknown, locator: string, emit: Emit): void {
  if (a === b) return;
  const typeA = jsonType(a);
  const typeB = jsonType(b);
  if (typeA !== typeB) {
    emit({ kind: 'shape-changed', locator, baselineValue: a, candidateValue: b });
    return;
  }
  if (typeA === 'array') {
    compareArrays(a as readonly unknown[], b as readonly unknown[], locator, emit);
    return;
  }
  if (typeA === 'object') {
    const recordA = a as Record<string, unknown>;
    const recordB = b as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(recordA), ...Object.keys(recordB)])].sort();
    for (const key of keys) {
      const child = `${locator}.${key}`;
      // Object.hasOwn, never `in`: keys like 'valueOf' or '__proto__' must not
      // match inherited members (found by the property suite, same lesson as
      // the Phase 1 __proto__ counterexample).
      if (!Object.hasOwn(recordB, key)) {
        emit({ kind: 'entry-removed', locator: child, baselineValue: recordA[key] });
      } else if (!Object.hasOwn(recordA, key)) {
        emit({ kind: 'entry-added', locator: child, candidateValue: recordB[key] });
      } else {
        compareJson(recordA[key], recordB[key], child, emit);
      }
    }
    return;
  }
  emit({ kind: 'value-changed', locator, baselineValue: a, candidateValue: b });
}
