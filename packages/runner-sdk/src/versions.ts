/**
 * SDK and protocol versions (Doc 20 §15).
 *
 * PROTOCOL_VERSION governs Runner<->engine compatibility: the engine refuses
 * runners with a different protocol major. Independent of the npm package
 * version, which follows semver for the TypeScript surface.
 */

export const RUNNER_SDK_VERSION = '0.1.0';

export const PROTOCOL_VERSION = 1;
