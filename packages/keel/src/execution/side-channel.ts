/**
 * Side-channel protocol (Doc 05, Doc 24 P7): NDJSON messages from
 * in-process interceptors on fd 3, parsed by the engine. Versioned (`v`);
 * unknown kinds and future versions are tolerated by skipping — the
 * backward-compatibility rule for a channel the runner asset and engine
 * evolve together.
 */

export const SIDE_CHANNEL_FD = 3;

/** One observed network call, as reported by the preload (metadata + hashes; bodies never cross the channel). */
export interface RawNetCall {
  readonly sequence: number;
  readonly method: string;
  readonly url: string;
  readonly status: number;
  readonly responseBodyHash?: string;
  readonly blocked?: boolean;
  readonly unrecorded?: boolean;
}

/** The exit-time interceptor report (Doc 04 InterceptorReport's runtime half). */
export interface InterceptorRuntimeReport {
  readonly protocolVersion: number;
  readonly armed: Readonly<Record<string, string>>;
  readonly tampered: boolean;
  readonly tamperFindings: readonly string[];
  readonly moduleGraph: readonly string[];
}

export interface SideChannelData {
  readonly netCalls: readonly RawNetCall[];
  readonly report: InterceptorRuntimeReport | null;
}

export const EMPTY_SIDE_CHANNEL: SideChannelData = { netCalls: [], report: null };

/** Tolerant NDJSON parse: malformed lines and unknown kinds are skipped, never fatal. */
export function parseSideChannel(bytes: Uint8Array): SideChannelData {
  const netCalls: RawNetCall[] = [];
  let report: InterceptorRuntimeReport | null = null;
  for (const line of new TextDecoder().decode(bytes).split('\n')) {
    if (line.trim().length === 0) continue;
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (message['v'] !== 1) continue;
    if (message['kind'] === 'net-call' && typeof message['sequence'] === 'number') {
      netCalls.push({
        sequence: message['sequence'],
        method: String(message['method'] ?? 'GET'),
        url: String(message['url'] ?? ''),
        status: typeof message['status'] === 'number' ? message['status'] : 0,
        ...(typeof message['responseBodyHash'] === 'string'
          ? { responseBodyHash: message['responseBodyHash'] }
          : {}),
        ...(message['blocked'] === true ? { blocked: true } : {}),
        ...(message['unrecorded'] === true ? { unrecorded: true } : {}),
      });
    } else if (message['kind'] === 'interceptor-report') {
      report = {
        protocolVersion: typeof message['protocolVersion'] === 'number' ? message['protocolVersion'] : 1,
        armed: (message['armed'] as Record<string, string> | undefined) ?? {},
        tampered: message['tampered'] === true,
        tamperFindings: (message['tamperFindings'] as string[] | undefined) ?? [],
        moduleGraph: (message['moduleGraph'] as string[] | undefined) ?? [],
      };
    }
  }
  netCalls.sort((a, b) => a.sequence - b.sequence);
  return { netCalls, report };
}
