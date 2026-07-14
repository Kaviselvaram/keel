/**
 * ConfigSnapshot → engine-input mapping, shared by Capture/Check services
 * (the C22 seam where config's output types meet the engines' consumer-owned
 * input types). The `satisfies` checks below are the compile-time
 * assignability assertions promised in the Phase 4/5 reviews.
 */

import { UserError } from '../shared/index.js';
import type { ConfigSnapshot } from '../config/index.js';
import type { ResolvedProbe } from '../execution/index.js';
import { BUILTIN_RULES, makeRule } from '../capture/index.js';
import type { NormalizationRule } from '../capture/index.js';

/** Resolves config probes (optionally filtered) into engine probes; unknown names are user errors. */
export function toResolvedProbes(
  config: ConfigSnapshot,
  filter: readonly string[] | undefined,
): readonly ResolvedProbe[] {
  const names = Object.keys(config.probes).sort();
  const selected = filter === undefined ? names : filter;
  return selected.map((name) => {
    const probe = config.probes[name];
    if (probe === undefined) {
      throw new UserError(`unknown probe '${name}'`, {
        code: 'KEEL_E_CAPTURE_UNKNOWN_PROBE',
        remediation: `declared probes: ${names.join(', ') || '(none)'}`,
        context: { name },
      });
    }
    return {
      name,
      runner: probe.runner,
      command: probe.command,
      args: probe.args,
      cwd: probe.cwd,
      stdinText: probe.stdin,
      envAllowlist: probe.env,
      timeoutMs: probe.timeoutMs,
      maxOutputBytes: probe.maxOutputBytes,
      maxFsEffectBytes: probe.maxFsEffectBytes,
      interception: probe.interception,
      hooks: probe.hooks,
      ignoreRules: probe.ignoreRules,
      serial: probe.serial,
    } satisfies ResolvedProbe;
  });
}

/** Built-in ruleset + user rules from config, compiled once per operation. */
export function compileRules(config: ConfigSnapshot): readonly NormalizationRule[] {
  const userRules = config.normalizationRules.map((rule) =>
    makeRule(rule.id, rule.pattern, rule.replacement),
  );
  return [...BUILTIN_RULES, ...userRules];
}
