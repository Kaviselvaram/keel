# ADR-015: Default local model & hardware floor

> Status: Accepted · Frozen in Architecture v1.0 (2026-07-12) · Source: [Doc 15](../architecture/15-adrs.md)

**Context:** Unresolved item #5; eval targets and README honesty depend on it. **Decision:** default classification model is a ~7B coder-instruct class model pulled via Ollama (initial default: `qwen2.5-coder:7b-instruct`; the default is *config data*, re-evaluated against the eval corpus each release cycle, changed only at minor versions with changelog notice, never auto-downloaded). Stated hardware floor: **8 GB RAM**; below floor or model absent, Tier 2 auto-disables with a visible verdict notice. **Alternatives:** 3B-class default (fits more machines, fails the precision bar in this class of task); 13B+ (excludes most laptops). **Consequences:** README states the floor plainly; eval-corpus CI pins the default model version for reproducible precision numbers.
