# ADR-005: Ollama as first inference provider

> Status: Accepted · Frozen in Architecture v1.0 (2026-07-12) · Source: [Doc 15](../architecture/15-adrs.md)

**Context:** Which local runtime to integrate first. **Decision:** Ollama. **Alternatives:** llama.cpp direct (no daemon dependency but native binding weight + model management UX becomes KEEL's problem); LM Studio (closed source — wrong first partner for an OSS tool); node-native inference (immature). **Consequences:** dominant local-AI install base, trivial model pulls, OpenAI-compatible-ish HTTP → provider port stays thin; llama.cpp-server support is a cheap second provider (roadmap P10) validating the abstraction.
