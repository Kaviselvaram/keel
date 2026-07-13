/**
 * Regenerates the canonical-serializer golden fixture from the BUILT model
 * (packages/keel/dist). Regeneration is a deliberate act (C70): run with
 * --write, review the diff, and expect to justify a CANONICAL_FORM_VERSION
 * bump in the same PR if any existing case changed.
 *
 * Inputs are spelled ASCII-only with explicit \u escapes so this file's
 * own encoding can never influence the fixture.
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const { canonicalSerialize, contentHashOf, CANONICAL_FORM_VERSION } = await import(
  '../packages/keel/dist/model/index.js'
);

const inputs = [
  ['empty object', {}],
  ['empty array', []],
  ['null and booleans', [null, true, false]],
  ['unsorted keys', { zebra: 1, alpha: { nested: [2, 3], aardvark: null }, mike: true }],
  ['numbers', [0, -0, 1, -3.14, 0.1, 1e21, 1e-7, 9007199254740991, 123456789.123]],
  // composed NFC: e-acute, e-grave precomposed; snowman; rocket (astral)
  ['unicode composed', { text: '\u00e9l\u00e8ve caf\u00e9 \u2603 \ud83d\ude80' }],
  // NFD-decomposed spelling of the same text: must canonicalize to identical bytes and hash
  ['unicode decomposed normalizes', { text: 'e\u0301le\u0300ve cafe\u0301 \u2603 \ud83d\ude80' }],
  ['string escapes', 'quote " backslash \\ newline \n tab \t nul \u0000 del \u007f'],
  ['lone surrogate', 'broken \ud800 pair'],
  ['unicode keys sorted after NFC', { 'k\u00e9y': 1, kex: 2, kez: 3 }],
  ['deep nesting', { a: { b: { c: { d: { e: [{ f: [[[1]]] }] } } } } }],
  ['undefined entries omitted', { keep: 1, drop: undefined }],
  ['probe-shaped document', {
    schemaVersion: 1,
    name: 'api-list-users',
    runner: 'command',
    captureMode: 'process',
    invocation: { command: 'node', args: ['server.js', '--once'], cwd: '.', stdin: { kind: 'none' }, envAllowlist: ['PATH'] },
    interception: { clock: 'virtual', rng: 'seeded', network: 'record' },
    limits: { timeoutMs: 30000, maxOutputBytes: 1048576, maxFsEffectBytes: 1048576 },
    hooks: {},
    ignoreRules: [],
    serial: false,
  }],
];

const cases = inputs.map(([name, input]) => ({
  name,
  input,
  canonical: canonicalSerialize(input),
  sha256: contentHashOf(input),
}));

const fixture = { canonicalFormVersion: CANONICAL_FORM_VERSION, cases };
const target = fileURLToPath(
  new URL('../packages/keel/src/model/__tests__/golden/canonical.golden.json', import.meta.url),
);

if (process.argv.includes('--write')) {
  writeFileSync(target, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`wrote ${String(cases.length)} golden cases to ${target}`);
} else {
  console.log(JSON.stringify(fixture, null, 2));
}
