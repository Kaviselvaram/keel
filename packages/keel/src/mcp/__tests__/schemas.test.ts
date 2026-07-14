import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { negotiateProtocolVersion, SUPPORTED_PROTOCOL_VERSIONS } from '../compat.js';
import { KEEL_MCP_SCHEMA_VERSION, TOOL_DEFINITIONS, validateToolArguments } from '../schemas.js';

describe('tool schema lockfile (Doc 09 §5, C72 — drift fails CI)', () => {
  it('the published lockfile matches the code exactly', () => {
    const lock = JSON.parse(
      readFileSync(
        fileURLToPath(new URL('../../../../../docs/reference/mcp-tools.lock.json', import.meta.url)),
        'utf8',
      ),
    ) as Record<string, unknown>;
    expect(lock).toEqual({
      keelMcpSchemaVersion: KEEL_MCP_SCHEMA_VERSION,
      supportedProtocolVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
      tools: JSON.parse(JSON.stringify(TOOL_DEFINITIONS)) as unknown,
    });
  });

  it('the frozen v1 surface is exactly the five Doc 09 tools, in order', () => {
    expect(TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual([
      'keel_status',
      'keel_capture',
      'keel_check',
      'keel_explain',
      'keel_suppress',
    ]);
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.inputSchema.additionalProperties).toBe(false);
    }
  });
});

describe('argument validation (strict, path-precise)', () => {
  const check = TOOL_DEFINITIONS.find((tool) => tool.name === 'keel_check');
  const capture = TOOL_DEFINITIONS.find((tool) => tool.name === 'keel_capture');
  if (check === undefined || capture === undefined) throw new Error('frozen tools missing');

  it('accepts valid arguments including empty for optional-only schemas', () => {
    expect(validateToolArguments(check, {})).toBeUndefined();
    expect(validateToolArguments(check, undefined)).toBeUndefined();
    expect(validateToolArguments(check, { all: true, probes: ['a'], budgetMs: 5 })).toBeUndefined();
    expect(validateToolArguments(capture, { label: 'main' })).toBeUndefined();
  });

  it('rejects unknown parameters, missing required, and wrong types with paths', () => {
    expect(validateToolArguments(check, { verbose: true })).toMatchObject({ path: 'arguments.verbose' });
    expect(validateToolArguments(capture, {})).toMatchObject({ path: 'arguments.label' });
    expect(validateToolArguments(check, { all: 'yes' })).toMatchObject({
      path: 'arguments.all',
      message: expect.stringContaining('boolean'),
    });
    expect(validateToolArguments(check, { probes: [1] })).toMatchObject({ path: 'arguments.probes' });
    expect(validateToolArguments(check, 'nope')).toMatchObject({ path: 'arguments' });
  });
});

describe('protocol negotiation (the compat seam)', () => {
  it('echoes supported revisions, answers newest otherwise', () => {
    expect(negotiateProtocolVersion('2025-03-26')).toBe('2025-03-26');
    expect(negotiateProtocolVersion('2099-01-01')).toBe(SUPPORTED_PROTOCOL_VERSIONS[0]);
    expect(negotiateProtocolVersion(undefined)).toBe(SUPPORTED_PROTOCOL_VERSIONS[0]);
  });
});
