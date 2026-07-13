/**
 * model/ — the Behavior Model (Ring 0). Public surface per Doc 20 §1:
 * entity types, canonical serialization, content hashing, schema versions,
 * type guards. Imports nothing but the platform (enforced by
 * dependency-cruiser; see README.md).
 */

export {
  MODEL_SCHEMA_VERSION,
  CANONICAL_FORM_VERSION,
  HASH_ALGORITHM,
  HASH_VERSION,
  SUPPORTED_SCHEMA_VERSIONS,
  assertSupportedSchemaVersion,
} from './versions.js';

export { ModelError, CanonicalizationError, HashMismatchError, ValidationError } from './errors.js';
export type { ModelErrorCode } from './errors.js';

export {
  isEntityId,
  isContentHash,
  isProbeName,
  assertEntityId,
  assertContentHash,
  assertProbeName,
} from './identity.js';
export type { EntityId, ContentHash, ProbeName } from './identity.js';

export { canonicalSerialize, canonicalBytes } from './canonical.js';
export type { CanonicalValue } from './canonical.js';

export {
  hashBytes,
  contentHashOf,
  merkleRootOfHashes,
  matchesContentHash,
  assertContentHash as verifyContentHash,
} from './hashing.js';

export { compareObservations, validateObservations } from './observation.js';
export type {
  Observation,
  ObservationKind,
  ExitOutcome,
  StreamName,
  StreamInterpretation,
} from './observation.js';

export { createProbeSpec, probeSpecHash } from './probe.js';
export type {
  ProbeSpec,
  ProbeSpecInput,
  ProbeInvocation,
  InterceptionPolicy,
  ProbeLimits,
  ProbeHooks,
  StdinSource,
} from './probe.js';

export { createExecutionRecord, executionContentHash } from './execution.js';
export type {
  ExecutionRecord,
  ExecutionRecordInput,
  RunnerDescriptor,
  InterceptorReport,
} from './execution.js';

export {
  createSnapshot,
  observationHash,
  snapshotMerkleRoot,
  verifySnapshotIntegrity,
} from './snapshot.js';
export type { Snapshot, SnapshotInput } from './snapshot.js';

export {
  createCapturingBaseline,
  withSnapshotRef,
  sealBaseline,
  rejectBaseline,
} from './baseline.js';
export type {
  Baseline,
  BaselineStatus,
  BaselineRejection,
  CapturingBaselineInput,
  Provenance,
  EnvironmentFingerprint,
} from './baseline.js';

export {
  DIVERGENCE_KINDS,
  isDivergenceKind,
  divergenceStableId,
  formatDivergencePath,
  createDivergence,
  compareDivergences,
} from './divergence.js';
export type { Divergence, DivergenceInput, DivergenceKind, DivergencePath } from './divergence.js';

export { createAnnotation } from './annotation.js';
export type {
  Annotation,
  AnnotationInput,
  IntentLabel,
  UncertainReason,
  ClassifierAttribution,
} from './annotation.js';

export { createCheckRun, createVerdict, withAnnotations } from './verdict.js';
export type {
  CheckRun,
  Verdict,
  VerdictInput,
  VerdictStatus,
  VerdictError,
  VerdictTiming,
  StalenessFinding,
} from './verdict.js';

export { createSuppression, absorbSuppression, expireSuppression } from './suppression.js';
export type {
  Suppression,
  SuppressionInput,
  SuppressionStatus,
  SuppressionTarget,
} from './suppression.js';
