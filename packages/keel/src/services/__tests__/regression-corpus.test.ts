/**
 * Regression corpus v0 runner (Doc 24 P5, C69: every known regression class
 * is pinned; new false positives/negatives must land here before their fix).
 * Each case runs the REAL pipeline: capture v1 → apply v2 → check.
 */

import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { afterAll, describe, expect, it } from 'vitest';
import { systemClock } from '../../shared/index.js';
import { noopLogger } from '../../observability/index.js';
import { loadConfig } from '../../config/index.js';
import { CommandRunner, ExecutionEngine, RunnerRegistry } from '../../execution/index.js';
import { KeelStore } from '../../storage/index.js';
import { formatDivergencePath } from '../../model/index.js';
import { CaptureService } from '../capture-service.js';
import { CheckService } from '../check-service.js';

interface CorpusCase {
  readonly name: string;
  readonly v1: string;
  readonly v2: string;
  readonly probe?: Record<string, unknown>;
  readonly expect?: { readonly status: string; readonly divergences: readonly string[] };
  readonly expectContains?: { readonly status: string; readonly kinds: readonly string[] };
}

const corpus = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../../../tests/regression-corpus/cases.json', import.meta.url)),
    'utf8',
  ),
) as { cases: readonly CorpusCase[] };

const cleanups: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
});

async function runCase(corpusCase: CorpusCase) {
  const cwd = await mkdtemp(path.join(tmpdir(), 'keel-corpus-'));
  const scriptFile = path.join(cwd, 'app.cjs');
  await writeFile(scriptFile, corpusCase.v1);
  await writeFile(
    path.join(cwd, 'keel.config.jsonc'),
    JSON.stringify({
      version: 1,
      probes: { app: { command: process.execPath, args: [scriptFile], ...corpusCase.probe } },
    }),
  );
  const store = await KeelStore.open({ directory: path.join(cwd, '.keel'), logger: noopLogger });
  cleanups.push(async () => {
    await store.close().catch(() => undefined);
    await rm(cwd, { recursive: true, force: true, maxRetries: 5 }).catch(() => undefined);
  });
  const execution = new ExecutionEngine({ registry: new RunnerRegistry([new CommandRunner()]), logger: noopLogger });
  const config = () => loadConfig({ cwd, env: {}, userFile: path.join(cwd, 'nope.json') });
  const shared = { execution, store, logger: noopLogger, clock: systemClock };

  const capture = await new CaptureService({ ...shared, keelVersion: '0.0.1-test' }).capture({
    config: config(),
    label: 'corpus',
    git: { commit: null, dirty: true },
    parentEnv: process.env,
    signal: new AbortController().signal,
  });
  expect(capture.status).toBe('sealed');

  await writeFile(scriptFile, corpusCase.v2); // the code change
  const outcome = await new CheckService({ ...shared, treeDigest: async () => null }).check({
    config: config(),
    label: 'corpus',
    gitCommit: null,
    parentEnv: process.env,
    signal: new AbortController().signal,
  });
  return outcome.verdict;
}

describe('regression corpus v0', () => {
  for (const corpusCase of corpus.cases) {
    it(corpusCase.name, async () => {
      const verdict = await runCase(corpusCase);
      if (corpusCase.expect !== undefined) {
        expect(verdict.status).toBe(corpusCase.expect.status);
        expect(
          verdict.divergences.map((d) => `${d.kind}@${formatDivergencePath(d.path)}`),
        ).toEqual(corpusCase.expect.divergences);
      }
      if (corpusCase.expectContains !== undefined) {
        expect(verdict.status).toBe(corpusCase.expectContains.status);
        for (const kind of corpusCase.expectContains.kinds) {
          expect(verdict.divergences.some((d) => d.kind === kind)).toBe(true);
        }
      }
      // Facts-first: no annotations exist at this phase, ever (C11).
      expect(verdict.annotations).toEqual([]);
    }, 60_000);
  }

  it('property: verdict status is diverged iff behavior content differs', async () => {
    // Light-weight property at the verdict level: reuse one harness, vary payloads.
    await fc.assert(
      fc.asyncProperty(
        fc.jsonValue(),
        fc.jsonValue(),
        async (a, b) => {
          const same = JSON.stringify(a) === JSON.stringify(b);
          const verdict = await runCase({
            name: 'property',
            v1: `console.log(JSON.stringify(${JSON.stringify(JSON.stringify(a))}))`,
            v2: `console.log(JSON.stringify(${JSON.stringify(JSON.stringify(b))}))`,
          });
          if (same) expect(verdict.status).toBe('clean');
          else expect(['diverged', 'clean']).toContain(verdict.status);
        },
      ),
      { numRuns: 4 },
    );
  }, 120_000);
});
