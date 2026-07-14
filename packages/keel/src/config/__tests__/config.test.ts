import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { UserError } from '../../shared/index.js';
import { loadConfig } from '../load.js';

const dirs: string[] = [];
afterAll(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function configDir(projectText: string, userText?: string): Promise<{ cwd: string; userFile: string }> {
  const cwd = await mkdtemp(path.join(tmpdir(), 'keel-config-'));
  dirs.push(cwd);
  await writeFile(path.join(cwd, 'keel.config.jsonc'), projectText);
  const userFile = path.join(cwd, 'user-config.json');
  if (userText !== undefined) await writeFile(userFile, userText);
  return { cwd, userFile };
}

const MINIMAL = `{
  // KEEL project configuration
  "version": 1,
  "probes": {
    "hello": { "command": "node", "args": ["-e", "console.log(1)"] },
  },
}`;

describe('layered loading and precedence (Doc 10 A1)', () => {
  it('loads a JSONC project file with comments and trailing commas, applying probe defaults', async () => {
    const { cwd, userFile } = await configDir(MINIMAL);
    const snapshot = loadConfig({ cwd, env: {}, userFile });
    const probe = snapshot.probes['hello'];
    expect(probe?.command).toBe('node');
    expect(probe?.timeoutMs).toBe(30_000);
    expect(probe?.interception).toEqual({ clock: 'none', rng: 'none', network: 'forbidden' });
    expect(snapshot.capture.verificationCount).toBe(2);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.probes['hello'])).toBe(true);
  });

  it('user file < env < invocation overrides for machine settings', async () => {
    const { cwd, userFile } = await configDir(MINIMAL, '{"logLevel":"warn"}');
    expect(loadConfig({ cwd, env: {}, userFile }).machine.logLevel).toBe('warn');
    expect(
      loadConfig({ cwd, env: { KEEL_LOG_LEVEL: 'debug' }, userFile }).machine.logLevel,
    ).toBe('debug');
    expect(
      loadConfig({ cwd, env: { KEEL_LOG_LEVEL: 'debug' }, userFile, overrides: { logLevel: 'trace' } })
        .machine.logLevel,
    ).toBe('trace');
  });

  it('resolves the store directory: default .keel, KEEL_STORE_DIR wins', async () => {
    const { cwd, userFile } = await configDir(MINIMAL);
    expect(loadConfig({ cwd, env: {}, userFile }).machine.storeDir).toBe(path.resolve(cwd, '.keel'));
    expect(
      loadConfig({ cwd, env: { KEEL_STORE_DIR: '/elsewhere' }, userFile }).machine.storeDir,
    ).toBe(path.resolve(cwd, '/elsewhere'));
  });

  it('invocation verificationCount override wins over the project file', async () => {
    const { cwd, userFile } = await configDir(
      '{"version":1,"probes":{"p":{"command":"x"}},"capture":{"verificationCount":5}}',
    );
    expect(loadConfig({ cwd, env: {}, userFile }).capture.verificationCount).toBe(5);
    expect(
      loadConfig({ cwd, env: {}, userFile, overrides: { verificationCount: 9 } }).capture
        .verificationCount,
    ).toBe(9);
  });
});

describe('behavior hash (ADR-011)', () => {
  it('comments, formatting, and machine settings never change the hash', async () => {
    const a = await configDir(MINIMAL);
    const b = await configDir(
      '{"probes":{"hello":{"args":["-e","console.log(1)"],"command":"node"}},"version":1}',
      '{"logLevel":"trace"}',
    );
    const hashA = loadConfig({ cwd: a.cwd, env: {}, userFile: a.userFile }).configHash;
    const hashB = loadConfig({ cwd: b.cwd, env: { KEEL_LOG_LEVEL: 'error' }, userFile: b.userFile }).configHash;
    expect(hashA).toBe(hashB);
  });

  it('probe changes change the hash; verification count does not (trust knob, not behavior)', async () => {
    const base = await configDir(MINIMAL);
    const changedProbe = await configDir(MINIMAL.replace('console.log(1)', 'console.log(2)'));
    const changedCount = await configDir(
      '{"version":1,"probes":{"hello":{"command":"node","args":["-e","console.log(1)"]}},"capture":{"verificationCount":7}}',
    );
    const hashBase = loadConfig({ cwd: base.cwd, env: {}, userFile: base.userFile }).configHash;
    expect(loadConfig({ cwd: changedProbe.cwd, env: {}, userFile: changedProbe.userFile }).configHash).not.toBe(hashBase);
    expect(loadConfig({ cwd: changedCount.cwd, env: {}, userFile: changedCount.userFile }).configHash).toBe(hashBase);
  });
});

describe('golden error cases (path-precise, Doc 24 P4)', () => {
  const cases: readonly { name: string; text: string; expectInMessage: string }[] = [
    { name: 'missing version', text: '{"probes":{}}', expectInMessage: 'version: expected version: 1' },
    { name: 'unknown root key', text: '{"version":1,"probez":{}}', expectInMessage: "unknown key 'probez'" },
    {
      name: 'probe missing command',
      text: '{"version":1,"probes":{"api":{}}}',
      expectInMessage: 'probes.api.command: a probe requires a command',
    },
    {
      name: 'unknown probe key',
      text: '{"version":1,"probes":{"api":{"command":"x","comand":"y"}}}',
      expectInMessage: "probes.api: unknown key 'comand'",
    },
    {
      name: 'bad interception enum',
      text: '{"version":1,"probes":{"api":{"command":"x","interception":{"clock":"frozen"}}}}',
      expectInMessage: 'probes.api.interception.clock: expected one of virtual | none',
    },
    {
      name: 'non-positive timeout',
      text: '{"version":1,"probes":{"api":{"command":"x","timeoutMs":0}}}',
      expectInMessage: 'probes.api.timeoutMs: expected a positive integer',
    },
    {
      name: 'invalid rule regex',
      text: '{"version":1,"normalization":{"rules":[{"id":"r","pattern":"([","replacement":"x"}]}}',
      expectInMessage: 'normalization.rules[0].pattern: pattern is not a valid regular expression',
    },
    {
      name: 'invalid jsonc syntax',
      text: '{"version":1,,}',
      expectInMessage: 'invalid JSONC',
    },
  ];

  for (const golden of cases) {
    it(golden.name, async () => {
      const { cwd, userFile } = await configDir(golden.text);
      try {
        loadConfig({ cwd, env: {}, userFile });
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(UserError);
        expect((error as UserError).message).toContain(golden.expectInMessage);
        expect((error as UserError).remediation.length).toBeGreaterThan(0);
      }
    });
  }

  it('user file cannot declare probes (project/user split is structural)', async () => {
    const { cwd, userFile } = await configDir(MINIMAL, '{"probes":{}}');
    expect(() => loadConfig({ cwd, env: {}, userFile })).toThrowError(/unknown key 'probes'/);
  });

  it('missing project file names the expected location', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'keel-config-'));
    dirs.push(cwd);
    expect(() => loadConfig({ cwd, env: {}, userFile: path.join(cwd, 'nope.json') })).toThrowError(
      /no keel\.config\.jsonc/,
    );
  });

  it('rejects an invalid KEEL_LOG_LEVEL env value', async () => {
    const { cwd, userFile } = await configDir(MINIMAL);
    expect(() => loadConfig({ cwd, env: { KEEL_LOG_LEVEL: 'loud' }, userFile })).toThrowError(
      /KEEL_LOG_LEVEL/,
    );
  });
});
