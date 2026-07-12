# ADR-003: SQLite index + content-addressed file store

> Status: Accepted · Frozen in Architecture v1.0 (2026-07-12) · Source: [Doc 15](../architecture/15-adrs.md)

**Context:** Local persistence of large immutable recordings plus queryable metadata. **Decision:** hybrid (Doc 08). **Alternatives:** all-SQLite (blob bloat, no inspectability, dedup requires hand-rolling); all-files (reinvents indexes badly); LevelDB/RocksDB (native-dep weight, no SQL, no inspectability); Postgres (a daemon — violates local-first ergonomics). **Consequences:** two consistency domains, bridged by "CAS write precedes index commit; index is source of reachability; GC scans" — git-proven pattern.
