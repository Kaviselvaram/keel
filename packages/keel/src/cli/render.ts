/**
 * Human rendering — pure projections of persisted documents (C12: never
 * fabricates content; everything shown exists in the store). Deterministic:
 * no colors, no timestamps beyond the documents' own fields, stable ordering
 * inherited from the documents.
 */

import type { BaselineSummary, CaptureResult, CheckReport } from '../services/index.js';

export function renderReport(report: CheckReport): string {
  const { verdict } = report;
  const lines: string[] = [];
  lines.push(`verdict ${verdict.id} — ${verdict.status.toUpperCase()}`);
  lines.push(`  baseline: ${verdict.baselineId}`);
  if (verdict.treeMutated) {
    lines.push('  warning: the working tree changed during this check — re-run for a trustworthy result (ADR-013)');
  }
  for (const finding of verdict.staleness) {
    lines.push(`  ${finding.policy === 'strict' ? 'stale' : 'drift'}: ${finding.field} expected=${finding.expected} actual=${finding.actual}`);
  }
  if (verdict.error !== null) {
    lines.push(`  error(${verdict.error.scope}): ${verdict.error.detail}`);
  }
  if (report.divergences.length > 0) {
    lines.push(`  divergences: ${String(report.divergences.length)} (${String(report.unsuppressedCount)} unsuppressed)`);
    for (const entry of report.divergences) {
      const suppressed = entry.suppressedBy === null ? '' : ` [suppressed by ${entry.suppressedBy}]`;
      lines.push(`    ${entry.divergence.kind}  ${entry.divergence.probeName}  ${entry.formattedPath}${suppressed}`);
    }
  }
  lines.push(
    `  timing: replay ${String(verdict.timing.replayMs)}ms · diff ${String(verdict.timing.diffMs)}ms · total ${String(verdict.timing.totalMs)}ms`,
  );
  return lines.join('\n');
}

export function renderBaselines(summaries: readonly BaselineSummary[]): string {
  if (summaries.length === 0) return "no baselines — run 'keel capture'";
  return summaries
    .map(
      (summary) =>
        `${summary.id}  ${summary.status.padEnd(8)}  label=${summary.label}` +
        (summary.sealedAtEpochMs === null ? '' : `  sealed=${new Date(summary.sealedAtEpochMs).toISOString()}`),
    )
    .join('\n');
}

export function renderCaptureResult(result: CaptureResult): string {
  if (result.status === 'sealed') {
    const secretProbes = Object.entries(result.secretFindings).filter(([, rules]) => rules.length > 0);
    const secretNote =
      secretProbes.length === 0
        ? ''
        : `\nwarning: secrets scrubbed in ${secretProbes.map(([probe, rules]) => `${probe} (${rules.join(', ')})`).join('; ')}`;
    return `baseline ${result.baseline.id} sealed (label=${result.baseline.label})${secretNote}`;
  }
  return [
    `baseline REJECTED — probe '${result.rejection.probeName}' is nondeterministic`,
    `  flapping path: ${result.rejection.flappingPath}`,
    `  ${result.rejection.reason}`,
    `  fix the volatility or add a normalization rule, then re-run 'keel capture'`,
  ].join('\n');
}
