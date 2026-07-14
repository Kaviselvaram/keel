/**
 * ReportService (Doc 20 §11): projects persisted Verdicts into the stable
 * report document adapters render (C12: `keel report <id>` reproduces
 * exactly what `keel check` showed). Suppressions are evaluated HERE —
 * presentation filtering, never fact filtering (Doc 04); expired ones
 * transition per ADR-014.
 */

import { UserError } from '../shared/index.js';
import type { Clock } from '../shared/index.js';
import type { Logger } from '../observability/index.js';
import type { Divergence, EntityId, Suppression, Verdict } from '../model/index.js';
import { expireSuppression, formatDivergencePath } from '../model/index.js';
import type { KeelStore } from '../storage/index.js';

/** One divergence as reported: the fact plus its presentation state. */
export interface ReportedDivergence {
  readonly divergence: Divergence;
  readonly formattedPath: string;
  /** Suppression id when an active suppression matches (fact still present — presentation only). */
  readonly suppressedBy: string | null;
}

/** The stable report document (versioned with the verdict schema). */
export interface CheckReport {
  readonly schemaVersion: 1;
  readonly verdict: Verdict;
  readonly divergences: readonly ReportedDivergence[];
  /** Divergence count remaining after suppression filtering (drives presentation emphasis). */
  readonly unsuppressedCount: number;
}

const globToRegExp = (pattern: string): RegExp =>
  new RegExp(
    `^${pattern
      .split('*')
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')}$`,
  );

function matches(suppression: Suppression, divergence: Divergence, formattedPath: string): boolean {
  if (suppression.target.kind === 'stable-id') {
    return suppression.target.stableId === divergence.stableId;
  }
  return globToRegExp(suppression.target.pattern).test(formattedPath);
}

export interface ReportServiceOptions {
  readonly store: KeelStore;
  readonly logger: Logger;
  readonly clock: Clock;
}

export class ReportService {
  private readonly options: ReportServiceOptions;

  constructor(options: ReportServiceOptions) {
    this.options = options;
  }

  /** Builds the report for a persisted verdict (by id) or an in-hand one (post-check). */
  async report(verdictOrId: Verdict | EntityId): Promise<CheckReport> {
    const verdict =
      typeof verdictOrId === 'string'
        ? await this.options.store.verdicts.getById(verdictOrId)
        : verdictOrId;
    if (verdict === undefined) {
      throw new UserError(`verdict '${String(verdictOrId)}' not found`, {
        code: 'KEEL_E_REPORT_VERDICT_NOT_FOUND',
        remediation: "list recent verdicts via 'keel baseline ls' and its checks, or rerun 'keel check'",
      });
    }

    // Expire due suppressions (ADR-014 declared transition), then evaluate active ones.
    const now = this.options.clock.epochMillis();
    const active: Suppression[] = [];
    for (const suppression of await this.options.store.suppressions.listByStatus('active')) {
      if (suppression.expiryEpochMs !== null && suppression.expiryEpochMs <= now) {
        await this.options.store.suppressions.transition(expireSuppression(suppression));
        this.options.logger.info('report.suppression.expired', { suppressionId: suppression.id });
      } else {
        active.push(suppression);
      }
    }

    const divergences: ReportedDivergence[] = verdict.divergences.map((divergence) => {
      const formattedPath = formatDivergencePath(divergence.path);
      const suppressor = active.find((suppression) => matches(suppression, divergence, formattedPath));
      return { divergence, formattedPath, suppressedBy: suppressor?.id ?? null };
    });

    return {
      schemaVersion: 1,
      verdict,
      divergences,
      unsuppressedCount: divergences.filter((entry) => entry.suppressedBy === null).length,
    };
  }
}
