#!/usr/bin/env node
/**
 * CLI composition root (C27) — the only CLI file allowed to wire
 * implementations. Phase 0: version/help plus the frozen exit contract.
 */

import { createRequire } from 'node:module';
import { EXIT_CODES } from '../shared/index.js';
import { parseArgs, USAGE } from './args.js';

const require = createRequire(import.meta.url);
const { version } = require('../../package.json') as { version: string };

const command = parseArgs(process.argv.slice(2));

switch (command.kind) {
  case 'version':
    console.log(`keel ${version}`);
    break;
  case 'help':
    console.log(USAGE);
    break;
  case 'unknown':
    console.error(`error: unknown argument '${command.input}' (KEEL_E_CLI_UNKNOWN_ARGUMENT)`);
    console.error(`fix: run 'keel --help' to see what this build supports`);
    process.exitCode = EXIT_CODES.user;
    break;
}
