# Verdict & Report Format Reference

The machine-readable contract every adapter projects (C12). All documents are schema-versioned; readers reject unknown majors (C34). `keel check --json`, `keel report --json`, and the MCP `keel_check` result all carry the same **CheckReport**:

```
CheckReport {
  schemaVersion: 1
  verdict: Verdict
  divergences: [{ divergence, formattedPath, suppressedBy: string|null }]
  unsuppressedCount: number        // drives CI exit semantics
}

Verdict {
  schemaVersion: 1
  id, checkRunId, baselineId       // ULIDs
  status: clean | diverged | stale-baseline | error
  divergences: Divergence[]        // sorted (probe, path, kind); unique stableIds
  annotations: []                  // classification appends later (Phases 8/9); facts never change
  replaySnapshots: {probeName: contentHash}
  codeDiffRef: null                // reserved for classification evidence (Phase 9)
  treeMutated: boolean             // ADR-013: the working tree changed mid-check
  staleness: [{field, expected, actual, policy: strict|warn}]  // warn = e.g. gitCommit ancestor-drift
  error: {scope, failedProbes, detail} | null
  timing: {replayMs, diffMs, classifyMs, totalMs}
}

Divergence {
  probeName
  path: {observation: exit|stream|fs-effect|net-call, locator}   // e.g. stream + stdout/json:$.items[3].price
  kind: value-changed | shape-changed | entry-added | entry-removed | order-changed |
        effect-added | effect-removed | effect-changed | unrecorded-effect |
        exit-changed | probe-failed
  baselineValueRef / candidateValueRef: sha-256 | null   // whole-stream refs are retrievable; leaf refs are identities (v1)
  stableId: sha-256(probeName, path, kind)               // survives re-runs; the suppression/explain key
}
```

Interpretation rules for agents: `status` is the truth; `unsuppressedCount === 0` on a `diverged` verdict means every change was explicitly accepted (CLI exits 0). `staleness` entries with `policy:'warn'` are context (proceeded anyway); a `stale-baseline` status means nothing was compared — follow the remediation and re-capture. `treeMutated: true` means re-run before trusting the result. `probe-failed` means the edit broke the probe's ability to run at all (timeout/output-limit) — usually the loudest possible regression.
