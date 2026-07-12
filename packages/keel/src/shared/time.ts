/**
 * Time-source port — Architecture v1.0, Doc 03 §3.11.
 *
 * Nothing outside this port reads the wall clock directly: injected time is
 * what makes deterministic tests of time-dependent behavior possible (L4).
 */

export interface Clock {
  now(): Date;
  epochMillis(): number;
}

export const systemClock: Clock = {
  now: () => new Date(),
  epochMillis: () => Date.now(),
};
