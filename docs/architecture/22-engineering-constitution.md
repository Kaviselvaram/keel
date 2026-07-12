# KEEL — Engineering Constitution

> Document 22 · Status: FROZEN — Architecture v1.0 (2026-07-12)
> These laws are mandatory for every implementation phase and every contributor. Amending this document requires two-maintainer agreement and an ADR (ADR-016). Rules marked ⚙ are machine-enforced (CI); the rest are review-enforced.

## I. Truth & Determinism (the identity of the product)

1. AI is never the source of truth. No LLM output may create, alter, suppress, or reorder a fact.
2. The deterministic runtime owns correctness; the diff engine's output is the verdict's factual content, complete before any classification runs.
3. ⚙ A build with `classify/` and `inference/` deleted must compile and pass every deterministic test.
4. Every persisted document is a pure function of its declared inputs; identical inputs produce byte-identical canonical output, on every platform. ⚙ (golden + property tests)
5. Nondeterminism is eliminated at capture time (interception + normalization), never papered over at diff time with fuzzy matching.
6. A probe that cannot pass verification replay is rejected at capture — never allowed to become a flaky baseline.
7. Wall-clock time, randomness, environment, locale, and timezone never enter canonical content unless deliberately observed through an interceptor.
8. The diff engine is pure: no I/O, no clock, no logging, no configuration loading. ⚙
9. Divergence output order is deterministic and defined (probe, kind, path). ⚙
10. Unknown behavior is reported as `uncertain`, never guessed. False confidence is a defect of the highest severity class.
11. Facts are persisted before annotations, always. A crash between the two loses advice, never truth. ⚙ (crash-injection tests)
12. A verdict is never fabricated by an adapter: every response is a projection of a persisted Verdict.

## II. Locality & Privacy

13. ⚙ No code path opens a socket to a non-loopback address. The CI zero-egress test is release-blocking.
14. Telemetry does not exist. No usage data, no crash auto-reporting, no update pings. Diagnostics leave the machine only by explicit user action.
15. The inference provider layer rejects non-loopback endpoints at construction time — privacy by type, not by configuration.
16. Models are never auto-downloaded.
17. Everything KEEL persists lives under the store directory; KEEL writes nowhere else except explicitly requested outputs.
18. Secrets: env allowlist only; secret-shaped values are scrubbed-and-flagged at capture; no env value or stdin payload is logged above trace, and trace hashes by default.

## III. Boundaries & Dependencies

19. ⚙ No circular dependencies at file granularity.
20. ⚙ The dependency matrix (Doc 21) is exhaustive: an import edge not listed there is a build failure. New edges require an ADR.
21. Domain objects never depend on infrastructure. `model/` imports nothing, not even `shared/`.
22. Ports are defined by their consumers; implementations never import their consumers.
23. ⚙ Only `execution/` spawns processes. Only `storage/` touches SQLite and the CAS. Only `inference/` opens sockets. Only `config/` reads env vars and config files.
24. ⚙ Capture, replay, diff, and execution never import classify or inference — the deterministic core cannot see AI.
25. ⚙ Only `classify/` may import `inference/`.
26. Business logic never lives in transport adapters. If an adapter contains a domain conditional, the code is in the wrong layer.
27. The composition roots (`cli/main`, `mcp/main`) are the only places where ports meet implementations.
28. `shared/` holds errors, ids, result types, and the time-source port — nothing else without sign-off.
29. An interface with one implementation and no test-double need is forbidden abstraction (YAGNI applies to abstraction).
30. No DI container. No global singletons. No ambient context. Constructor injection only.
31. Plugins cross the boundary only through `@keel/runner-sdk`; the SDK never imports the `keel` package. ⚙

## IV. Data & Persistence

32. Persisted documents are immutable. The only UPDATEs are declared status transitions; everything else is append or GC-delete.
33. A content hash seen once means the same bytes forever. CAS objects are never rewritten; migration never alters hashed content.
34. Every persisted document carries a `schemaVersion`. Readers reject unknown majors and tolerate unknown optional fields.
35. Every logical operation is one transaction; a partially visible baseline or verdict is a critical bug. ⚙ (crash-injection)
36. SQLite is never accessed outside `storage/` repository implementations; SQL never appears in another module. ⚙
37. Canonical serialization is defined once, in `model/`, and its byte output is golden-tested. ⚙
38. Store paths never participate in content hashes; nothing machine-specific enters shareable content.
39. GC never runs implicitly during a check; reclamation is explicit and refcount-verified.
40. Baselines are sealed or they do not exist to readers. Suppressions transition `active → absorbed/expired`, never vanish.

## V. Execution & Safety

41. User code always runs out-of-process, in a process group / Job Object that KEEL can kill entirely.
42. A user-code failure (non-zero exit, crash, timeout) is an observation, never an engine error.
43. Every execution has a timeout, an output byte cap, and an fs-effect cap — no unbounded resource path exists. ⚙ (contract kit)
44. Cancellation is `AbortSignal` end-to-end; every public async operation accepts one; abort reaches subprocess kill within the stated budget. ⚙
45. Probes execute in a shadow workdir; the user's tree is never dirtied by replay.
46. Only declared invocations run. KEEL never synthesizes and executes a command that is not in sealed config, and no LLM output is ever interpreted as a path, command, or code.
47. Sandbox claims in docs must match implementation reality — overclaiming containment is treated as a security defect.
48. Runner plugins are executables from the user's trust perspective; the docs must say so, and the contract kit includes a no-egress assertion.

## VI. AI Discipline

49. Classification output is only ever advisory annotation: label + confidence + rationale. It triggers no actions.
50. Every annotation is attributed: tier, ruleId or model + template version, and evidence hash. Unattributable judgments are discarded.
51. The heuristic tier runs before the LLM tier, always; anything a deterministic rule can decide, it must decide.
52. Prompt templates are versioned artifacts, reviewed like code, and gated by the eval corpus. ⚙ (eval CI on template/model change)
53. Model output is schema-validated; malformed output gets one retry, then `uncertain`. Model output is rendered as inert text everywhere.
54. Classification has a hard wall-clock budget; budget exhaustion is visible in the verdict, never silent.
55. Every degradation of AI capability (provider down, model missing, breaker open) appears in the verdict. Silent degradation is forbidden.
56. Confidence is reported in honest coarse bands; fake precision is a defect.
57. Default model changes are minor-version events with changelog notice and eval evidence.

## VII. Errors, Logging, Config

58. Every error crossing a module boundary is a typed member of the Doc 10 hierarchy — never a bare string or naked Error.
59. `InternalError` (invariant violation) fails fast and loudly with a diagnostics pointer. KEEL never swallows its own bugs.
60. User-facing errors state what, why, and exactly how to fix, with a docs link. Error text is reviewed as product surface.
61. The five-code exit contract (0/1/2/3/4) is frozen; adapters map outcomes to it and nothing else.
62. All logging is structured NDJSON through the injected Logger port; no `console.*` outside the CLI renderer. ⚙ (lint)
63. Every operation carries a correlation `opId` present on every log line and every entity it creates.
64. No module reads env vars or config files except `config/`; everything downstream receives the frozen ConfigSnapshot. ⚙
65. Unknown config keys are hard errors. Every knob has a documented default. Behavior-affecting config is hashed into provenance.
66. Presentation-only config never invalidates baselines; behavior-affecting config always does. The schema marks which is which.

## VIII. Testing & Change Discipline

67. Every port ships a contract-test kit; every implementation, including third-party, must pass it. ⚙
68. The determinism gate (capture→replay ×N across the OS matrix) is release-blocking, permanently. ⚙
69. Every user-reported false positive or false negative becomes a regression-corpus case before its fix merges.
70. Golden files (canonical bytes, verdict schema, MCP schemas, CLI output) change only with explicit acknowledgment in review. ⚙
71. Eval-corpus ground-truth labels require two-maintainer agreement.
72. Public API surface changes (exports, tool schemas, config schema, store schema) fail CI unless the corresponding lockfile is deliberately updated. ⚙
73. New architectural decisions during implementation are recorded as ADRs before the code merges; the roadmap phases reference Architecture v1.0 rather than re-deciding.
74. Performance budgets (Doc 12) are CI gates, not aspirations. ⚙
75. KEEL dogfoods KEEL from Phase 5 onward; a change that breaks KEEL-on-KEEL does not merge. ⚙
