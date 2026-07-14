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
import type { Annotation, ContentHash, Divergence, EntityId, Suppression, Verdict } from '../model/index.js';
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

  /**
   * Deep detail for one divergence (the keel_explain use case, Doc 09 §3):
   * the fact, retrievable values, suppression state, prior annotations.
   * Searches the given verdict or the most recent ones.
   */
  async explain(stableId: ContentHash, verdictId?: EntityId): Promise<ExplainReport> {
    const candidates =
      verdictId !== undefined ? [verdictId] : this.options.store.verdicts.listRecentIds(20);
    for (const id of candidates) {
      const report = await this.report(id);
      const entry = report.divergences.find((d) => d.divergence.stableId === stableId);
      if (entry === undefined) continue;
      return {
        schemaVersion: 1,
        verdictId: report.verdict.id,
        divergence: entry.divergence,
        formattedPath: entry.formattedPath,
        suppressedBy: entry.suppressedBy,
        annotations: report.verdict.annotations.filter(
          (annotation) => annotation.divergenceStableId === stableId,
        ),
        baselineValue: await this.retrieveValue(entry.divergence.baselineValueRef),
        candidateValue: await this.retrieveValue(entry.divergence.candidateValueRef),
      };
    }
    throw new UserError(`divergence '${stableId}' not found in recent verdicts`, {
      code: 'KEEL_E_REPORT_DIVERGENCE_NOT_FOUND',
      remediation: 'pass the verdictId from the keel_check result the stableId came from',
      context: { stableId },
    });
  }

  /** Whole-stream refs are real CAS objects; leaf refs are identities only (v1). */
  private async retrieveValue(ref: ContentHash | null): Promise<ExplainedValue> {
    if (ref === null) return { present: false, reason: 'no-value-on-this-side' };
    try {
      const bytes = await this.options.store.objects.get(ref);
      return { present: true, ref, text: new TextDecoder().decode(bytes) };
    } catch {
      return { present: false, reason: 'value-ref-not-materialized', ref };
    }
  }
}

/** A retrievable-or-identified divergence value (Doc 09 §3 keel_explain). */
export type ExplainedValue =
  | { readonly present: true; readonly ref: ContentHash; readonly text: string }
  | { readonly present: false; readonly reason: string; readonly ref?: ContentHash };

/** The keel_explain result document. */
export interface ExplainReport {
  readonly schemaVersion: 1;
  readonly verdictId: EntityId;
  readonly divergence: Divergence;
  readonly formattedPath: string;
  readonly suppressedBy: string | null;
  readonly annotations: readonly Annotation[];
  readonly baselineValue: ExplainedValue;
  readonly candidateValue: ExplainedValue;
}
