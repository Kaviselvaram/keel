/**
 * ULID generation — Architecture v1.0, Doc 04 (creation-ordered entity ids)
 * and Doc 03 §3.11.
 *
 * Implemented in-house: the minimal-dependency policy (Doc 11 §7) outweighs
 * a dependency for ~60 lines of spec. Monotonic within a millisecond so ids
 * created in one process sort in creation order even under bursts.
 */

import { randomBytes } from 'node:crypto';
import { InternalError } from './errors.js';
import type { Clock } from './time.js';
import { systemClock } from './time.js';

/** Crockford base32 (ULID spec): no I, L, O, U. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_LENGTH = 10;
const RANDOM_LENGTH = 16;
const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** Largest timestamp encodable in 48 bits, per the ULID spec. */
const MAX_TIME = 2 ** 48 - 1;

function encodeTime(epochMillis: number): string {
  if (!Number.isInteger(epochMillis) || epochMillis < 0 || epochMillis > MAX_TIME) {
    throw new InternalError('timestamp outside ULID range', {
      code: 'KEEL_E_ULID_TIME_RANGE',
      context: { epochMillis },
    });
  }
  let remaining = epochMillis;
  const chars = new Array<string>(TIME_LENGTH);
  for (let i = TIME_LENGTH - 1; i >= 0; i--) {
    chars[i] = ALPHABET[remaining % 32] as string;
    remaining = Math.floor(remaining / 32);
  }
  return chars.join('');
}

function randomChars(): string[] {
  const bytes = randomBytes(RANDOM_LENGTH);
  const chars = new Array<string>(RANDOM_LENGTH);
  for (let i = 0; i < RANDOM_LENGTH; i++) {
    // byte & 31 is uniform over the 32-character alphabet (256 = 8 × 32).
    chars[i] = ALPHABET[(bytes[i] as number) & 31] as string;
  }
  return chars;
}

/** Increments a base32 char array in place; throws on overflow (spec behavior). */
function incrementRandom(chars: string[]): void {
  for (let i = chars.length - 1; i >= 0; i--) {
    const index = ALPHABET.indexOf(chars[i] as string);
    if (index < 31) {
      chars[i] = ALPHABET[index + 1] as string;
      return;
    }
    chars[i] = ALPHABET[0] as string;
  }
  throw new InternalError('ULID randomness overflow within one millisecond', {
    code: 'KEEL_E_ULID_OVERFLOW',
  });
}

export type UlidGenerator = () => string;

/**
 * Creates a monotonic ULID generator bound to a clock. Generator instances
 * carry their own monotonicity state — inject a fake clock in tests.
 */
export function createUlidGenerator(clock: Clock = systemClock): UlidGenerator {
  let lastTime = -1;
  let lastRandom: string[] = [];

  return () => {
    const now = clock.epochMillis();
    if (now === lastTime) {
      incrementRandom(lastRandom);
    } else {
      lastTime = now;
      lastRandom = randomChars();
    }
    return encodeTime(lastTime) + lastRandom.join('');
  };
}

/** Default process-wide generator on the system clock (opIds, entity ids). */
export const ulid: UlidGenerator = createUlidGenerator();

export function isUlid(value: string): boolean {
  return ULID_PATTERN.test(value);
}
