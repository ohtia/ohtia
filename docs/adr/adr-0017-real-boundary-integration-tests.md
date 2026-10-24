---
type: DecisionRecord
title: "ADR-0017 — Integration evidence at real local boundaries"
description: "Verify SQLite, IPC, packaged processes and provider capabilities at the boundaries that determine their behavior."
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
---

# ADR-0017 — Integration evidence at real local boundaries

## Context

Mocks help reproduce error handling but do not prove database constraints, native input, OS confinement or installed-process behavior. An all-mock suite offers speed and deterministic failures but cannot demonstrate the actual SQLite driver, Electron IPC or OS boundaries. Real-boundary integration complements those focused doubles with evidence from the components that enforce the contract.

## Decision

Use deterministic doubles for application state, partial streams and tool errors. Verify transactions, constraints, foreign keys, concurrency, recovery and migrations against the actual selected SQLite binding/runtime with representative files. An in-memory substitute or mocked repository does not prove file-backed durability and locking.

Exercise actual preload/main/data-service messages, child processes, permissions, object files and pre-migration recovery checkpoints. Run editor/CSP/input tests against packaged or release-equivalent artifacts; a standalone browser or dev server is insufficient for desktop privileges and lifecycle. Synthetic composition events do not prove OS IME composition.

Keep provider conformance separate, using synthetic input, declared accounts, explicit spending authorization and bounded attempts. Adapter tests do not establish equal model quality. Native platform and assistive-technology results identify the actual OS, artifact and journeys; unexecuted platforms remain unverified.

Use isolated data directories and fixtures, never private research or developer credential copies. Record coverage and limitations without representing unit doubles as real integrations.

## Consequences

Real boundaries increase setup and run cost but catch failures absent from unit tests. Verify valid and negative paths, crashes, cancellation, corrupt/missing files and denied operations. A missing environment cannot be replaced with a mock and reported as equivalent evidence.
