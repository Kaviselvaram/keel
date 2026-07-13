/** Shared valid fixtures for entity tests (test-only). */

import type { Observation } from '../observation.js';
import type { Provenance } from '../baseline.js';

export const ULID_A = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
export const ULID_B = '01BX5ZZKBKACTAV9WEVGEMMVRZ';
export const HASH_A = 'a'.repeat(64);
export const HASH_B = 'b'.repeat(64);

export const validObservations: readonly Observation[] = [
  { kind: 'exit', outcome: { kind: 'exited', code: 0 } },
  { kind: 'stream', stream: 'stdout', contentHash: HASH_A, byteLength: 120, interpretation: 'json' },
  { kind: 'stream', stream: 'stderr', contentHash: HASH_B, byteLength: 0, interpretation: 'text' },
  { kind: 'fs-effect', path: 'out/report.json', effect: 'created', contentHash: HASH_A },
  { kind: 'net-call', sequence: 0, request: { method: 'GET', url: 'https://api.local/users' }, response: { status: 200, bodyHash: HASH_B } },
];

export const validProvenance: Provenance = {
  gitCommit: '5f59ce2e07d13224ef49cf79f347c8889ec34e62',
  gitDirty: false,
  configHash: HASH_A,
  environment: {
    os: 'darwin',
    arch: 'arm64',
    runtimeName: 'node',
    runtimeVersion: '24.15.0',
    icuVersion: '76.1',
    interceptorVersions: {},
  },
  keelVersion: '0.0.1',
  normalizationRulesetVersion: 'rules/1',
};
