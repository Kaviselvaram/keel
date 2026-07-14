/**
 * services/ — Application Services (Doc 20 §11): the seam between engines
 * and adapters. Owns use-case orchestration, facts-first persistence
 * ordering, and the ConfigSnapshot → engine-input mapping.
 */

export { CaptureService } from './capture-service.js';
export type { CaptureServiceOptions, CaptureCommand } from './capture-service.js';

export { CheckService } from './check-service.js';
export type { CheckServiceOptions, CheckCommand, CheckOutcome, TreeDigest } from './check-service.js';

export { ReportService } from './report-service.js';
export type { ReportServiceOptions, CheckReport, ReportedDivergence } from './report-service.js';

export { BaselineAdminService } from './baseline-admin-service.js';

export { toResolvedProbes, compileRules } from './probe-mapping.js';

// Adapter-visible result types re-exported at the service seam (C26: adapters
// import services only; these are the documents their projections render).
export type { CaptureResult, CaptureProgress } from '../capture/index.js';
export type { BaselineSummary } from '../storage/index.js';
