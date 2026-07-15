/**
 * KEEL dependency rules — machine encoding of Architecture v1.0, Doc 21 §1.
 *
 * Rules cite the Engineering Constitution (Doc 22) law they enforce.
 * Rules for modules that do not exist yet are included deliberately: the gate
 * must be complete before the code arrives (Doc 24, Phase 0).
 * Adding or relaxing an edge requires an ADR (C20).
 */

/** The two composition roots are the only files allowed to wire ports to implementations (C27). */
const COMPOSITION_ROOTS = '^packages/keel/src/(cli|mcp)/main\\.ts$';

module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      comment: 'C19: no circular dependencies at file granularity',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'model-imports-nothing',
      comment: 'C21: model/ imports nothing, not even shared/',
      severity: 'error',
      from: { path: '^packages/keel/src/model' },
      to: { path: '^packages/keel/src/(?!model)' },
    },
    {
      name: 'model-no-npm',
      comment: 'Doc 20 §1: model dependency budget is platform stdlib only — npm packages banned (tests exempt)',
      severity: 'error',
      from: { path: '^packages/keel/src/model', pathNot: '__tests__' },
      to: { dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer', 'npm-bundled', 'npm-no-pkg'] },
    },
    {
      name: 'shared-is-leaf',
      comment: 'C28: shared/ may not import any other module',
      severity: 'error',
      from: { path: '^packages/keel/src/shared' },
      to: { path: '^packages/keel/src/(?!shared)' },
    },
    {
      name: 'observability-is-leaf',
      comment: 'Doc 21: observability depends on shared only',
      severity: 'error',
      from: { path: '^packages/keel/src/observability' },
      to: { path: '^packages/keel/src/(?!observability|shared)' },
    },
    {
      name: 'diff-is-pure',
      comment: 'C8: diff imports model only — no I/O, no logging, no config',
      severity: 'error',
      from: { path: '^packages/keel/src/diff' },
      to: { path: '^packages/keel/src/(?!diff|model)' },
    },
    {
      name: 'inference-only-from-classify',
      comment: 'C25: only classify/ (and composition roots) may import inference/',
      severity: 'error',
      from: {
        path: '^packages/keel/src',
        pathNot: `^packages/keel/src/(classify|inference)|${COMPOSITION_ROOTS}`,
      },
      to: { path: '^packages/keel/src/inference' },
    },
    {
      name: 'inference-is-domain-blind',
      comment: 'Doc 20 §7: inference knows nothing domain-shaped',
      severity: 'error',
      from: { path: '^packages/keel/src/inference' },
      to: { path: '^packages/keel/src/(?!inference|shared|observability)' },
    },
    {
      name: 'deterministic-core-cannot-see-ai',
      comment: 'C24: capture/replay/diff/execution never import classify or inference',
      severity: 'error',
      from: { path: '^packages/keel/src/(capture|replay|diff|execution)' },
      to: { path: '^packages/keel/src/(classify|inference)' },
    },
    {
      name: 'adapters-through-services-only',
      comment: 'C26: no business logic in transport adapters; composition roots exempt (C27)',
      severity: 'error',
      from: {
        path: '^packages/keel/src/(mcp|cli)',
        pathNot: COMPOSITION_ROOTS,
      },
      to: { path: '^packages/keel/src/(capture|replay|diff|execution|storage|classify|inference|config)' },
    },
    {
      name: 'services-not-adapters',
      comment: 'Doc 21: dependency inversion — adapters depend on services, never the reverse',
      severity: 'error',
      from: { path: '^packages/keel/src/services' },
      to: { path: '^packages/keel/src/(mcp|cli)' },
    },
    {
      name: 'storage-is-leaf',
      comment: 'Doc 20 §8: storage implements consumer-owned ports; imports model/observability/shared only',
      severity: 'error',
      from: { path: '^packages/keel/src/storage' },
      to: { path: '^packages/keel/src/(?!storage|model|observability|shared)' },
    },
    {
      name: 'config-is-leaf',
      comment: 'Doc 20 §9: config depends on model and shared only',
      severity: 'error',
      from: { path: '^packages/keel/src/config' },
      to: { path: '^packages/keel/src/(?!config|model|shared)' },
    },
    {
      name: 'execution-is-isolated',
      comment: 'Doc 20 §2: execution imports model/observability/shared (+ runner-sdk) only',
      severity: 'error',
      from: { path: '^packages/keel/src/execution' },
      to: { path: '^packages/keel/src/(?!execution|model|observability|shared)' },
    },
    {
      name: 'capture-forbidden-edges',
      comment: 'Doc 21: capture uses ports; never adapters, services, config, diff, replay, or AI',
      severity: 'error',
      from: { path: '^packages/keel/src/capture' },
      to: { path: '^packages/keel/src/(mcp|cli|services|config|diff|replay|classify|inference|storage)' },
    },
    {
      name: 'replay-forbidden-edges',
      comment: 'Doc 21/Doc 20 §4: replay must not compare (diff), normalize directly (capture), or touch adapters/config/storage/AI',
      severity: 'error',
      from: { path: '^packages/keel/src/replay' },
      to: { path: '^packages/keel/src/(mcp|cli|services|config|diff|capture|classify|inference|storage)' },
    },
    {
      name: 'classify-forbidden-edges',
      comment: 'Doc 20 §6 / Doc 21: classify depends on model + inference-port + config only; receives evidence, returns annotations. Forbidden: storage, execution, capture, replay, diff internals, adapters, and services (deletability C3 — services owns the port, classify implements structurally).',
      severity: 'error',
      from: { path: '^packages/keel/src/classify' },
      to: { path: '^packages/keel/src/(storage|execution|capture|replay|diff|mcp|cli|services)' },
    },
    {
      name: 'sqlite-only-in-storage',
      comment: 'C36: SQLite is never accessed outside storage/ repositories',
      severity: 'error',
      from: { path: '^packages/(keel|runner-sdk)/src', pathNot: '^packages/keel/src/storage' },
      to: { path: 'better-sqlite3' },
    },
    {
      name: 'mcp-only-from-cli-main',
      comment: 'Doc 09 §2: the host spawns `keel mcp` — only the CLI composition root may import the MCP adapter',
      severity: 'error',
      from: { path: '^packages/keel/src', pathNot: `^packages/keel/src/mcp|${COMPOSITION_ROOTS}` },
      to: { path: '^packages/keel/src/mcp' },
    },
    {
      name: 'runner-sdk-standalone',
      comment: 'C31: the SDK never imports the keel package (one-way plugin boundary)',
      severity: 'error',
      from: { path: '^packages/runner-sdk' },
      to: { path: '^packages/keel' },
    },
  ],
  options: {
    // doNotFollow (not exclude): npm modules stay visible as edge targets so
    // the model-no-npm rule can see them; only built output is fully excluded.
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)dist/' },
    // All KEEL-internal imports are relative (Doc 23) — no tsconfig paths to resolve.
    tsPreCompilationDeps: true,
  },
};
