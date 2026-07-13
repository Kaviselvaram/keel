# ADR-017: Windows group-kill via process-tree termination (taskkill), not Job Objects

> Status: Proposed (freeze amendment) · Raised during Phase 2 implementation · Amends: Doc 05 §3, Doc 24 Phase 2

**Context:** Doc 05 §3 and the Phase 2 playbook name Windows **Job Objects** as the group-kill mechanism. Implementation exposed a conflict with a stronger frozen constraint: Node.js has no built-in Job Objects API, so true Job Objects require a native addon — and the supply-chain posture (Doc 11 §7, Doc 25 security gate) freezes the native-dependency budget at `better-sqlite3` only. The two frozen statements cannot both hold.

**Decision:** Windows group-kill is implemented as **process-tree termination** (`taskkill /pid <root> /T /F`), spawned with `windowsHide`. POSIX platforms keep true process groups (`detached: true`, signal to `-pid`, SIGTERM → grace → SIGKILL). The architecture's *acceptance criterion* — kill leaves zero orphans, verified by a process-table assertion in the engine test suite on all tier-1 platforms — is unchanged and met.

**Trade-off accepted:** tree termination walks the parent-child chain at kill time; a grandchild that detaches from the tree before the kill (deliberate daemonization) can escape, which a kernel Job Object would prevent. Daemonizing probes are already outside KEEL's determinism model (an execution whose effects outlive it cannot be replayed), so the gap affects no supported behavior. Windows also has no graceful tree signal, so the polite-then-forced grace window is POSIX-only; on Windows kills are immediate and forced.

**Alternatives rejected:** native addon (violates the frozen dependency budget; a worse trade than the daemonization edge case); PowerShell CIM tree-walk (slower, same guarantee level as taskkill); accepting root-only kill (fails the acceptance criterion outright).

**Revisit trigger:** if a future phase adopts OS-level sandboxing on Windows (Phase 13, AppContainer), Job Objects come along naturally with that native surface — this ADR should be revisited then.
