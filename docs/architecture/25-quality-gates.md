# KEEL — Quality Gates

> Document 25 · Status: FROZEN — Architecture v1.0 (2026-07-12)
> Every phase-closing PR attaches this checklist, completed. Gates marked ⚙ run in CI and block merge mechanically; ☐ are reviewer-verified. A gate that doesn't apply to a phase is marked N/A with one line of justification — never silently skipped.

## Architecture
- ⚙ dependency-cruiser: zero violations of the Doc 21 matrix; zero cycles at file granularity
- ⚙ AI-deletable build green (from Phase 8)
- ☐ new/changed public surfaces cite their Doc 20 contract; no contract drifted without a freeze-amendment ADR
- ☐ no new abstraction without a second implementation or test-double need (C29)

## Security
- ⚙ zero-egress test green across the full suite
- ⚙ dependency audit (npm audit + OSV) clean or waivered with expiry; lockfile diff reviewed
- ☐ no new runtime dep with install scripts; native deps unchanged (better-sqlite3 only)
- ☐ new execution paths have timeout + output cap + fs cap (C43); env allowlist intact
- ☐ no LLM output interpreted as path/command/code anywhere (C46); model output rendered inert

## Testing
- ⚙ fast lane + full 3-OS matrix green; determinism gate green (from Phase 4)
- ⚙ contract kits pass for every port implementation touched
- ⚙ property suites green with standard budgets; golden files changed only with explicit acknowledgment
- ☐ every fixed false positive/negative has a corpus case merged first (C69)

## Performance
- ⚙ bench budgets hold: check ≤30s (no-LLM) / ≤90s (LLM) on reference repo; memory ceiling respected
- ☐ no unbounded buffering introduced (streams + spill files on any new data path)

## Documentation
- ☐ generated references (config keys, error codes, verdict schema, MCP tools) regenerated in the same PR as their source
- ☐ module READMEs updated for touched modules; guides updated for user-visible changes
- ☐ ADR filed for every decision the Constitution requires one for (C73)

## Logging & Observability
- ☐ new operations emit begin/end spans with `opId`; event names follow `module.action.outcome`
- ☐ no `console.*` outside CLI renderer (⚙ lint); no secrets above trace (redaction test updated if new value kinds logged)

## Configuration
- ☐ every new key: schema + default + behavior/presentation classification + generated doc, same PR (C65–66)
- ⚙ config golden-error tests updated; unknown-key rejection intact

## Open Source
- ☐ changesets entry present; conventional commits; DCO sign-off
- ☐ public contract changes noted in compatibility notes (CLI/MCP, runner-sdk, store schema)

## Developer Experience
- ☐ every new `UserError` meets the what/why/fix/docs-link bar (C60)
- ☐ examples still pass CI smoke; first-verdict time budget unharmed (from Phase 11: ≤3 min gate)

## Maintainability & Extensibility
- ☐ no module README's "what may import me" list violated; `shared/` unchanged or sign-off recorded (C28)
- ☐ extension-point registries (rules, comparators, providers, runners) used for extensions — no special-casing in walkers/dispatchers
