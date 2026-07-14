/**
 * Dogfooding gate (Doc 24 P5, C75: KEEL dogfoods KEEL): runs the BUILT CLI
 * against this repository's own keel.config.jsonc and asserts the full
 * command surface plus the five-code exit contract. The store lives in a
 * temp directory (KEEL_STORE_DIR) so CI runners stay clean.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repoRoot, 'packages', 'keel', 'dist', 'cli', 'main.js');
const modelUrl = pathToFileURL(path.join(repoRoot, 'packages', 'keel', 'dist', 'model', 'index.js')).href;
if (!existsSync(cli)) {
  console.error('dogfood: build first (packages/keel/dist missing)');
  process.exit(1);
}

const storeDir = mkdtempSync(path.join(tmpdir(), 'keel-dogfood-'));
const env = {
  ...process.env,
  KEEL_STORE_DIR: storeDir,
  KEEL_CLI: cli,
  KEEL_MODEL_URL: modelUrl,
};

let failures = 0;
function keel(args, expectedExit, label) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: repoRoot, env, encoding: 'utf8' });
  const ok = result.status === expectedExit;
  console.log(`${ok ? 'PASS' : 'FAIL'}  keel ${args.join(' ')}  (exit ${String(result.status)}, expected ${String(expectedExit)}) — ${label}`);
  if (!ok) {
    failures += 1;
    console.log(result.stdout);
    console.error(result.stderr);
  }
  return result;
}

// 1. Checking before any baseline exists is a user error (exit 2).
keel(['check'], 2, 'no baseline yet');
// 2. Capture and seal a baseline of KEEL's own behavior.
keel(['capture', '--label', 'dogfood'], 0, 'capture seals');
// 3. Unchanged code: the check is clean (exit 0).
const check = keel(['check', '--label', 'dogfood', '--json'], 0, 'clean check');
// 4. Re-projecting the persisted verdict reproduces the result (C12).
const verdictId = /"id":"([0-9A-HJKMNP-TV-Z]{26})"/.exec(check.stdout)?.[1];
if (verdictId === undefined) {
  console.error('FAIL  could not extract verdict id from --json output');
  failures += 1;
} else {
  keel(['report', verdictId], 0, 'report re-projects the verdict');
}
// 5. Baseline administration round-trip.
keel(['baseline', 'ls'], 0, 'baseline ls');

rmSync(storeDir, { recursive: true, force: true, maxRetries: 5 });
if (failures > 0) {
  console.error(`dogfood: ${String(failures)} failure(s)`);
  process.exit(1);
}
console.log('dogfood: KEEL validated KEEL — all green');
