---
type: DecisionRecord
title: "ADR-0002 — TypeScript product services with local IPC"
description: "Use strict TypeScript across the desktop product and exchange validated local messages without a Python application server."
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
sources:
  - id: electron
    resource: "https://www.electronjs.org/docs/latest/tutorial/process-model"
    title: "Electron — Process model"
  - id: ipc
    resource: "https://www.electronjs.org/docs/latest/tutorial/ipc"
    title: "Electron — IPC"
  - id: ts
    resource: "https://www.typescriptlang.org/tsconfig/strict.html"
    title: "TypeScript — strict"
---

# ADR-0002 — TypeScript product services with local IPC

## Context

Electron already provides a Node environment for privileged local components.[^electron] The desktop has no hosted API or account service, and its application data service can validate storage and manuscript contracts in the same language as other product components. A separate Python service and HTTP transport would add another shipped runtime and interface without an identified requirement.

## Decision

Write the renderer, preload, main broker, trusted data service and application/domain logic in strict TypeScript. Keep expensive database/document work outside the UI and main event loop in supervised utility/restricted processes. Sharing a language does not collapse privilege boundaries.

Use named Electron IPC and private local process channels with versioned request/result/event schemas, bounded payloads, correlation, errors and cancellation. Validate sender, scope and data at runtime; TypeScript annotations alone do not validate messages. The renderer receives named operations through preload, not arbitrary IPC, SQL, filesystem or process proxies.[^ipc]

Do not introduce FastAPI, a loopback HTTP API or a Python product runtime for these responsibilities. Developer repository scripts may use Python under [ADR-0005](adr-0005-python-repository-tooling.md); users do not install it to use Ohtia. A future specialist processor can justify a separately packaged runtime through a concrete capability/maintenance evaluation.

Use TypeScript `6.0.*` with its strict checks, including explicit handling of absent values and validated external input.[^ts] The typed lint tools selected in [ADR-0004](adr-0004-javascript-development-toolchain.md) must support the selected compiler API; verify their peer constraints and integrated behavior with the exact locked patches.

## Consequences

One product language avoids cross-language domain/AST implementations and a mandatory second interpreter. It does not eliminate dependencies on packaged converter binaries or agent runtimes. Verify runtime-invalid messages, spoofed senders, stale scope, utility-process death and packaged startup. Reconsider Python only for a demonstrated capability that offsets packaging and maintenance costs, not as an inherited default.

[^electron]: Electron provides Node capabilities outside its web renderer.

[^ipc]: Electron documents message-based communication between its processes; Ohtia defines the domain contracts.

[^ts]: The strict flag enables the compiler strict-check family; runtime boundary validation remains necessary.
