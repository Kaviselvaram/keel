/**
 * Runner capability descriptors and negotiation (Doc 05, Doc 20 §15).
 *
 * Capabilities are honest claims: a runner declares only what it can enforce
 * on every platform it lists (the "half-capability" ban, Doc 05 §1). The
 * engine negotiates required-vs-offered before execution; replay uses the
 * same negotiation against baseline-required interceptors.
 */

/** Interceptor capability identifiers (closed set for protocol v1; Doc 04 interception policies). */
export const INTERCEPTOR_CAPABILITIES = ['clock', 'rng', 'network'] as const;

export type InterceptorCapability = (typeof INTERCEPTOR_CAPABILITIES)[number];

export type SupportedPlatform = 'linux' | 'darwin' | 'win32';

export interface RunnerCapabilities {
  readonly runnerId: string;
  readonly runnerVersion: string;
  readonly protocolVersion: number;
  readonly platforms: readonly SupportedPlatform[];
  /** Interceptors this runner can arm, with their implementation versions (participate in fingerprints, Doc 05). */
  readonly interceptors: Readonly<Partial<Record<InterceptorCapability, string>>>;
}

export interface NegotiationSuccess {
  readonly ok: true;
}

export interface NegotiationFailure {
  readonly ok: false;
  readonly missingInterceptors: readonly InterceptorCapability[];
  readonly platformUnsupported: boolean;
  readonly protocolMismatch: boolean;
}

export type NegotiationResult = NegotiationSuccess | NegotiationFailure;

/**
 * Pure capability negotiation: can `offered` satisfy an execution needing
 * `requiredInterceptors` on `platform` at `protocolVersion`?
 */
export function negotiateCapabilities(
  offered: RunnerCapabilities,
  requiredInterceptors: readonly InterceptorCapability[],
  platform: SupportedPlatform,
  protocolVersion: number,
): NegotiationResult {
  const protocolMismatch = offered.protocolVersion !== protocolVersion;
  const platformUnsupported = !offered.platforms.includes(platform);
  const missingInterceptors = requiredInterceptors.filter(
    (capability) => offered.interceptors[capability] === undefined,
  );
  if (protocolMismatch || platformUnsupported || missingInterceptors.length > 0) {
    return { ok: false, missingInterceptors, platformUnsupported, protocolMismatch };
  }
  return { ok: true };
}
