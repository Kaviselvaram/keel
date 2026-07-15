/**
 * The Node preload shim, embedded as a source string and materialized into
 * the workspace as a SpawnPlan file (Doc 05: preload interceptors; the shim
 * ships with the runner, never with the probed code).
 *
 * Constraints honored inside the shim: documented Node APIs only (the
 * interceptor-churn risk rule, Doc 24 P7); CommonJS (loaded via
 * NODE_OPTIONS=--require); zero dependencies; side-channel messages are
 * NDJSON on fd 3; tamper detection compares patched identities at exit.
 */

export const PRELOAD_FILE_NAME = 'keel-node-preload.cjs';

export const SIDE_CHANNEL_PROTOCOL_VERSION = 1;

/** Per-interceptor implementation versions — participate in fingerprints (Doc 05). */
export const NODE_INTERCEPTOR_VERSIONS = {
  clock: 'node-clock/1',
  rng: 'node-rng/1',
  network: 'node-net/1',
} as const;

export const PRELOAD_SOURCE = `'use strict';
/* KEEL node preload — generated asset; versions: clock=node-clock/1 rng=node-rng/1 net=node-net/1 */
const fs = require('fs');
const crypto = require('crypto');

const env = process.env;
const SIDE_FD = 3;
const messages = [];
function emit(message) {
  messages.push(JSON.stringify(message));
}
function flush() {
  try {
    fs.writeSync(SIDE_FD, messages.join('\\n') + '\\n');
  } catch (ignored) { /* channel absent: engine did not request it */ }
}

const armed = {};
const tamper = [];

/* ── virtual clock (documented surface: Date, Date.now, performance.now) ── */
const RealDate = Date;
let patchedNow = null;
if (env.KEEL_CLOCK === 'virtual') {
  const epoch = Number(env.KEEL_CLOCK_EPOCH || '946684800000');
  let tick = 0;
  patchedNow = function now() { return epoch + (tick++); };
  const VirtualDate = new Proxy(RealDate, {
    construct(target, args) {
      return args.length === 0 ? new target(patchedNow()) : new target(...args);
    },
    apply() { return new RealDate(patchedNow()).toString(); },
    get(target, prop) {
      if (prop === 'now') return patchedNow;
      return Reflect.get(target, prop);
    },
    set(target, prop, value) {
      // Determinism holds (get keeps serving the virtual clock), but the
      // attempt is a tamper finding — visible, never silent.
      if (prop === 'now') tamper.push('Date.now reassignment attempted');
      return Reflect.set(target, prop, value);
    },
  });
  globalThis.Date = VirtualDate;
  var virtualDateRef = VirtualDate;
  if (globalThis.performance && typeof globalThis.performance.now === 'function') {
    let perfTick = 0;
    globalThis.performance.now = function now() { return perfTick++; };
  }
  armed.clock = 'node-clock/1';
  emit({ v: 1, kind: 'interceptor-armed', interceptor: 'clock', epoch: epoch });
}

/* ── seeded randomness (Math.random via mulberry32) ── */
if (env.KEEL_RNG === 'seeded') {
  let state = (Number(env.KEEL_RNG_SEED || '1') >>> 0) || 1;
  const seeded = function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  Math.random = seeded;
  var seededRef = seeded;
  armed.rng = 'node-rng/1';
  emit({ v: 1, kind: 'interceptor-armed', interceptor: 'rng', seed: Number(env.KEEL_RNG_SEED || '1') });
}

/* ── network (fetch): record / stub / forbidden ── */
const netMode = env.KEEL_NET || 'none';
if (netMode !== 'none' && typeof globalThis.fetch === 'function') {
  const realFetch = globalThis.fetch;
  let sequence = 0;
  const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
  let recordings = null;
  if (netMode === 'stub' && env.KEEL_NET_RECORDINGS) {
    recordings = JSON.parse(fs.readFileSync(env.KEEL_NET_RECORDINGS, 'utf8'));
  }
  globalThis.fetch = async function keelFetch(input, init) {
    const seq = sequence++;
    const url = typeof input === 'string' ? input : (input && input.url) || String(input);
    const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    if (netMode === 'forbidden') {
      emit({ v: 1, kind: 'net-call', sequence: seq, method: method, url: url, status: 0, blocked: true });
      throw new Error('KEEL: network is forbidden for this probe (interception.network=forbidden)');
    }
    if (netMode === 'stub') {
      const key = method + ' ' + url;
      const hit = recordings && recordings[key] && recordings[key][String(seq)] !== undefined
        ? recordings[key][String(seq)]
        : (recordings ? recordings[key] : undefined);
      if (hit === undefined) {
        emit({ v: 1, kind: 'net-call', sequence: seq, method: method, url: url, status: 0, unrecorded: true });
        throw new Error('KEEL: no recording for ' + key + ' (stub mode)');
      }
      const body = Buffer.from(hit.bodyBase64 || '', 'base64');
      emit({ v: 1, kind: 'net-call', sequence: seq, method: method, url: url, status: hit.status, responseBodyHash: sha(body) });
      return new Response(body, { status: hit.status });
    }
    // record mode: real call, hashed metadata over the side channel.
    const response = await realFetch(input, init);
    const clone = response.clone();
    const bytes = Buffer.from(await clone.arrayBuffer());
    emit({ v: 1, kind: 'net-call', sequence: seq, method: method, url: url, status: response.status, responseBodyHash: sha(bytes) });
    return response;
  };
  armed.network = 'node-net/1';
}

/* ── exit-time reporting: module graph + tamper checks (documented APIs) ── */
process.on('exit', () => {
  const moduleGraph = Object.keys(require.cache || {}).sort();
  if (patchedNow !== null && globalThis.Date !== virtualDateRef) {
    tamper.push('globalThis.Date was replaced after arming');
  }
  if (typeof seededRef !== 'undefined' && Math.random !== seededRef) {
    tamper.push('Math.random was replaced after arming');
  }
  emit({
    v: 1,
    kind: 'interceptor-report',
    protocolVersion: ${String(SIDE_CHANNEL_PROTOCOL_VERSION)},
    armed: armed,
    tampered: tamper.length > 0,
    tamperFindings: tamper,
    moduleGraph: moduleGraph,
  });
  flush();
});
`;
