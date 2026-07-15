/**
 * The Normalizer (Doc 20 §3): raw execution results → canonical
 * observations + normalized stream payloads. This is the single place that
 * knows what is volatile (Doc 03 §3.2).
 *
 * Stream pipeline: decode UTF-8 (binary passthrough on decode failure or
 * NUL bytes) → sniff JSON (canonical re-serialization on success) → apply
 * scrub rules to string content → payload bytes + observation.
 */

import { canonicalBytes, hashBytes } from '../model/index.js';
import type { ContentHash, Observation } from '../model/index.js';
import { compareObservations } from '../model/index.js';
import type { ExecutionResult } from '../execution/index.js';
import type { NormalizationRule } from './rules.js';

export interface NormalizedExecution {
  /** In canonical order, ready for createSnapshot. */
  readonly observations: readonly Observation[];
  /** Normalized stream payloads keyed by their content hash (CAS candidates + verification material). */
  readonly payloads: ReadonlyMap<ContentHash, Uint8Array>;
  /** Ids of secret rules that fired (scrubbed-and-flagged; values never appear here). */
  readonly secretFindings: readonly string[];
}

const decoder = new TextDecoder('utf-8', { fatal: true });
const encoder = new TextEncoder();

function scrubText(text: string, rules: readonly NormalizationRule[], firedSecrets: Set<string>): string {
  let output = text;
  for (const rule of rules) {
    if (rule.pattern.test(output)) {
      if (rule.secret) firedSecrets.add(rule.id);
      rule.pattern.lastIndex = 0;
      output = output.replace(rule.pattern, rule.replacement);
    }
    rule.pattern.lastIndex = 0;
  }
  return output;
}

function scrubJsonValue(value: unknown, rules: readonly NormalizationRule[], firedSecrets: Set<string>): unknown {
  if (typeof value === 'string') return scrubText(value, rules, firedSecrets);
  if (Array.isArray(value)) return value.map((item) => scrubJsonValue(item, rules, firedSecrets));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        scrubJsonValue(entry, rules, firedSecrets),
      ]),
    );
  }
  return value;
}

interface NormalizedStream {
  readonly bytes: Uint8Array;
  readonly interpretation: 'text' | 'json' | 'binary';
}

function normalizeStream(
  raw: Uint8Array,
  rules: readonly NormalizationRule[],
  firedSecrets: Set<string>,
): NormalizedStream {
  let text: string;
  try {
    text = decoder.decode(raw);
  } catch {
    return { bytes: raw, interpretation: 'binary' };
  }
  if (text.includes('\u0000')) return { bytes: raw, interpretation: 'binary' };

  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      const scrubbed = scrubJsonValue(parsed, rules, firedSecrets);
      return { bytes: canonicalBytes(scrubbed), interpretation: 'json' };
    } catch {
      // fall through to text handling — not JSON after all
    }
  }
  // Text: scrub, and normalize CRLF so Windows children compare with POSIX.
  const scrubbed = scrubText(text.replace(/\r\n/g, '\n'), rules, firedSecrets);
  return { bytes: encoder.encode(scrubbed), interpretation: 'text' };
}

/** Raw execution result → canonical observation set (deterministic, pure). */
export function normalizeExecution(
  result: ExecutionResult,
  rules: readonly NormalizationRule[],
): NormalizedExecution {
  const firedSecrets = new Set<string>();
  const payloads = new Map<ContentHash, Uint8Array>();
  const observations: Observation[] = [];

  observations.push({ kind: 'exit', outcome: result.exit });

  for (const [stream, raw] of [
    ['stdout', result.stdout],
    ['stderr', result.stderr],
  ] as const) {
    const normalized = normalizeStream(raw, rules, firedSecrets);
    const contentHash = hashBytes(normalized.bytes);
    payloads.set(contentHash, normalized.bytes);
    observations.push({
      kind: 'stream',
      stream,
      contentHash,
      byteLength: normalized.bytes.byteLength,
      interpretation: normalized.interpretation,
    });
  }

  for (const event of result.fsEvents) {
    observations.push({
      kind: 'fs-effect',
      path: event.path,
      effect: event.change,
      ...(event.change === 'deleted' ? {} : { contentHash: event.hash as ContentHash }),
    });
  }

  // Side-channel net calls (Doc 24 P7) — URLs are scrubbed like any value.
  for (const call of result.sideChannel.netCalls) {
    observations.push({
      kind: 'net-call',
      sequence: call.sequence,
      request: { method: call.method, url: scrubText(call.url, rules, firedSecrets) },
      response: {
        status: call.status,
        ...(call.responseBodyHash === undefined ? {} : { bodyHash: call.responseBodyHash as ContentHash }),
      },
    });
  }

  observations.sort(compareObservations);
  return { observations, payloads, secretFindings: [...firedSecrets].sort() };
}
