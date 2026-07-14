/**
 * CLI e2e against the BUILT binary (dist): the full command surface, the
 * five-code exit contract, and the init→capture→edit→check regression loop.
 * CI builds before testing (same guard as the crash matrix).
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const cliPath = fileURLToPath(new URL('../../../dist/cli/main.js', import.meta.url));
const distReady = existsSync(cliPath);
if (!distReady && process.env['CI'] !== undefined) {
  throw new Error('CLI e2e requires the built dist in CI — build must precede test');
}

const dirs: string[] = [];
afterAll(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 5 })));
});

function keel(cwd: string, args: readonly string[]) {
  const result = spawnSync(process.execPath, [cliPath, ...args], { cwd, encoding: 'utf8' });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe.skipIf(!distReady)('keel CLI end-to-end', () => {
  it('walks the whole MVP loop with correct exit codes', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'keel-cli-'));
    dirs.push(cwd);
    const scriptFile = path.join(cwd, 'app.cjs');
    await writeFile(scriptFile, `console.log(JSON.stringify({v:1}))`);

    // init: scaffolds once, refuses twice (exit 2).
    expect(keel(cwd, ['init']).code).toBe(0);
    expect(keel(cwd, ['init']).code).toBe(2);

    // check before any baseline: user error (exit 2) with remediation.
    await writeFile(
      path.join(cwd, 'keel.config.jsonc'),
      JSON.stringify({ version: 1, probes: { app: { command: process.execPath, args: [scriptFile] } } }),
    );
    const noBaseline = keel(cwd, ['check', '--label', 'demo']);
    expect(noBaseline.code).toBe(2);
    expect(noBaseline.stderr).toContain('keel capture');

    // capture: seals (exit 0), progress on stderr, result on stdout.
    const capture = keel(cwd, ['capture', '--label', 'demo']);
    expect(capture.code).toBe(0);
    expect(capture.stdout).toContain('sealed');
    expect(capture.stderr).toContain('verify app');

    // clean check: exit 0.
    const clean = keel(cwd, ['check', '--label', 'demo']);
    expect(clean.code).toBe(0);
    expect(clean.stdout).toContain('CLEAN');

    // the edit: behavior changes → exit 1, divergence named.
    await writeFile(scriptFile, `console.log(JSON.stringify({v:2}))`);
    const diverged = keel(cwd, ['check', '--label', 'demo', '--json']);
    expect(diverged.code).toBe(1);
    expect(diverged.stdout).toContain('"status":"diverged"');
    expect(diverged.stdout).toContain('stream:stdout/json:$.v');

    // report re-projects the persisted verdict (C12) with the same exit code.
    const verdictId = /"id":"([0-9A-HJKMNP-TV-Z]{26})"/.exec(diverged.stdout)?.[1] ?? '';
    const report = keel(cwd, ['report', verdictId]);
    expect(report.code).toBe(1);
    expect(report.stdout).toContain('value-changed');

    // baseline administration.
    const ls = keel(cwd, ['baseline', 'ls']);
    expect(ls.code).toBe(0);
    expect(ls.stdout).toContain('label=demo');
    const baselineId = /^([0-9A-HJKMNP-TV-Z]{26})/m.exec(ls.stdout)?.[1] ?? '';
    expect(keel(cwd, ['baseline', 'rm', baselineId]).code).toBe(0);
    expect(keel(cwd, ['baseline', 'rm', baselineId]).code).toBe(2);
  }, 120_000);

  it('maps error classes to the frozen exit contract', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'keel-cli-'));
    dirs.push(cwd);
    // Unknown command → 2 (user).
    expect(keel(cwd, ['transmogrify']).code).toBe(2);
    // Missing config for a store-backed command → 2 with the expected path named.
    const noConfig = keel(cwd, ['check']);
    expect(noConfig.code).toBe(2);
    expect(noConfig.stderr).toContain('keel.config.jsonc');
    // Broken config → 2, path-precise.
    await writeFile(path.join(cwd, 'keel.config.jsonc'), '{"version":2}');
    const badConfig = keel(cwd, ['capture']);
    expect(badConfig.code).toBe(2);
    expect(badConfig.stderr).toContain('version');
  }, 60_000);
});
