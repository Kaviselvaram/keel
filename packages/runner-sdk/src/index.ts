/**
 * @keel/runner-sdk — the public contract for KEEL runner plugins.
 *
 * Phase 0 scaffold (Architecture v1.0, Doc 24): the package exists in the
 * workspace from day one because the Node deep runner (Phase 2/7) consumes
 * these types across a real package boundary.
 *
 * The Runner port, Observation schemas, capability descriptors, and the
 * contract-test kit are defined in Phase 2 per Doc 20 §15. This module is
 * deliberately dependency-free and never imports the `keel` package (C31).
 */

export const RUNNER_SDK_VERSION = '0.0.1';
