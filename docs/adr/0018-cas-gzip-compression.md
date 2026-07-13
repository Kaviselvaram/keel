# ADR-018: CAS compression via built-in gzip, not zstd

> Status: Proposed (freeze amendment) · Raised during Phase 3 implementation · Amends: Doc 08, Doc 24 Phase 3

**Context:** Doc 08 and the Phase 3 playbook name **zstd** for CAS object compression. Implementation exposed a conflict: `node:zlib` gained zstd only in Node ≥23.8, KEEL's supported floor is the oldest supported LTS (Node 22 as of this writing; CI matrix runs 22 and 24 per ADR-001's "Node LTS" policy), and a native zstd package violates the frozen native-dependency budget (Doc 11 §7, `better-sqlite3` only) — the same class of conflict as ADR-017.

**Decision:** CAS objects are compressed with **gzip** from `node:zlib` (available on every supported Node). The encoding is recorded per object (`objects.encoding`, constrained to `gzip | raw`), so adding zstd later is an additive schema change, not a migration of existing objects. Content hashes are always computed over **uncompressed** bytes — compression is transport, never identity — so no compression change can ever invalidate a baseline (C33 preserved by construction).

**Trade-off accepted:** gzip compresses somewhat worse and slower than zstd. For KEEL's object profile (canonical JSON documents and captured text streams, typically KBs to low MBs), the difference is disk space measured in percents, not integrity or correctness.

**Alternatives rejected:** native zstd binding (violates the frozen budget for a disk-space optimization); no compression (canonical JSON is highly compressible; 3–10× space for one `gzipSync` call is free value); brotli (built-in too, better ratio but significantly slower to compress at default quality — wrong trade for write-path latency).

**Revisit trigger:** when the supported Node floor reaches ≥24 (zlib zstd stable), add `zstd` to the encoding enum for new objects; old objects stay valid forever.
