/**
 * The frozen v1 tool surface (Doc 09 §3): definitions as data — names,
 * descriptions, JSON Schemas — plus path-precise validators. This file is
 * the source of the schema lockfile (docs/reference/mcp-tools.lock.json);
 * drift fails CI (Doc 09 §5, C72).
 */

export const KEEL_MCP_SCHEMA_VERSION = '1.0.0';

interface SchemaProperty {
  readonly type: 'string' | 'boolean' | 'number' | 'array';
  readonly description: string;
  readonly items?: { readonly type: 'string' };
}

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: {
    readonly type: 'object';
    readonly properties: Readonly<Record<string, SchemaProperty>>;
    readonly required: readonly string[];
    readonly additionalProperties: false;
  };
}

const tool = (
  name: string,
  description: string,
  properties: Readonly<Record<string, SchemaProperty>>,
  required: readonly string[] = [],
): ToolDefinition => ({
  name,
  description,
  inputSchema: { type: 'object', properties, required, additionalProperties: false },
});

/** Order is frozen — it defines lockfile and tools/list ordering. */
export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  tool(
    'keel_status',
    'Cheap pre-flight: is KEEL initialized here, which baselines exist and how fresh they are, how many probes are declared, whether classification is available. Call before capture/check.',
    {},
  ),
  tool(
    'keel_capture',
    'Execute all (or named) probes, verify determinism, and seal a baseline. Destructive-ish: requires an explicit label. Returns the sealed baseline id and provenance, or a structured rejection naming the flapping path.',
    {
      label: { type: 'string', description: 'Baseline label (ADR-012: resolution key; convention is the git branch)' },
      probes: { type: 'array', items: { type: 'string' }, description: 'Restrict to these probe names (all when omitted)' },
    },
    ['label'],
  ),
  tool(
    'keel_check',
    'The oracle: replay the baseline, diff behavior, return the persisted verdict. Default scope is diff-scoped (sound over-approximation; the Phase 12 dependency map narrows it); pass all=true to force full replay. Domain outcomes (stale-baseline, no baseline, busy) are structured results, not errors.',
    {
      label: { type: 'string', description: 'Baseline label to resolve (default: current git branch)' },
      baselineId: { type: 'string', description: 'Explicit baseline id (overrides label resolution)' },
      all: { type: 'boolean', description: 'Force full replay instead of the diff-scoped default' },
      probes: { type: 'array', items: { type: 'string' }, description: 'Explicit probe subset (overrides scoping)' },
      classify: { type: 'boolean', description: 'Request advisory classification (unavailable until Phase 9; result notes it)' },
      budgetMs: { type: 'number', description: 'Classification wall-clock budget (inert until Phase 9)' },
    },
  ),
  tool(
    'keel_explain',
    'Deep detail for one divergence by stableId: full baseline/candidate values where retrievable, suppression state, prior annotations. Keeps keel_check responses small.',
    {
      stableId: { type: 'string', description: 'The divergence stableId from a keel_check result' },
      verdictId: { type: 'string', description: 'Verdict to search (default: the most recent verdict)' },
    },
    ['stableId'],
  ),
  tool(
    'keel_suppress',
    'Record "this divergence is accepted": append-only, reasoned. Filters presentation and CI exit semantics; the persisted facts are never altered. Absorbed automatically when a new baseline seals (ADR-014).',
    {
      stableId: { type: 'string', description: 'Suppress this exact divergence (exclusive with pattern)' },
      pattern: { type: 'string', description: "Glob over formatted paths, e.g. 'stream:stdout/json:$.meta.*' (exclusive with stableId)" },
      reason: { type: 'string', description: 'Why this change is accepted (audit trail)' },
      expiresInDays: { type: 'number', description: 'Optional expiry; absent means no expiry' },
    },
    ['reason'],
  ),
];

/* ── validation (path-precise, config-style) ─────────────────────────── */

export interface ValidationFailure {
  readonly path: string;
  readonly message: string;
}

export function validateToolArguments(
  definition: ToolDefinition,
  args: unknown,
): ValidationFailure | undefined {
  if (args === undefined) args = {};
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    return { path: 'arguments', message: 'expected an object' };
  }
  const record = args as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!Object.hasOwn(definition.inputSchema.properties, key)) {
      return { path: `arguments.${key}`, message: `unknown parameter (known: ${Object.keys(definition.inputSchema.properties).join(', ') || 'none'})` };
    }
  }
  for (const requiredKey of definition.inputSchema.required) {
    if (record[requiredKey] === undefined) {
      return { path: `arguments.${requiredKey}`, message: 'required parameter is missing' };
    }
  }
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) continue;
    const property = definition.inputSchema.properties[key] as SchemaProperty;
    if (property.type === 'array') {
      if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
        return { path: `arguments.${key}`, message: 'expected an array of strings' };
      }
    } else if (typeof value !== property.type) {
      return { path: `arguments.${key}`, message: `expected ${property.type}, received ${typeof value}` };
    }
  }
  return undefined;
}
