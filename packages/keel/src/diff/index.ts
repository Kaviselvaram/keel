/**
 * diff/ — the Diff Engine (Ring 1, Doc 20 §5). Pure: model is the only
 * dependency (CI-enforced). Answers "what changed", never "is it a
 * regression" (that is classification's question, and it is advisory).
 */

export { diffSnapshots } from './engine.js';
export type { DiffOptions } from './engine.js';

export { compileIgnoreRules } from './ignore-rules.js';
export type { CompiledIgnoreRule } from './ignore-rules.js';

export { compareJson } from './json-compare.js';
export type { JsonDifference, JsonDiffKind } from './json-compare.js';
