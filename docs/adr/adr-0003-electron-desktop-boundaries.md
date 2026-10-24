---
type: DecisionRecord
title: "ADR-0003 — Electron desktop with explicit privilege boundaries"
description: "Use Electron with a React and TypeScript renderer separated from privileged local services."
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
sources:
  - id: electron-processes
    resource: "https://www.electronjs.org/docs/latest/tutorial/process-model"
    title: "Electron — Process model"
  - id: tauri-processes
    resource: "https://v2.tauri.app/concept/process-model/"
    title: "Tauri — Process model"
  - id: tauri-node
    resource: "https://v2.tauri.app/learn/sidecar-nodejs/"
    title: "Tauri — Node.js as a sidecar"
  - id: electron
    resource: "https://www.electronjs.org/docs/latest/tutorial/security"
    title: "Electron — Security"
  - id: electron-release
    resource: "https://registry.npmjs.org/electron/45.0.0"
    title: "Electron — Package metadata"
---

# ADR-0003 — Electron desktop with explicit privilege boundaries

## Context

The researcher needs installable graphical applications on Windows, macOS and Linux. Ohtia needs an academic editing interface, local TypeScript services and explicit separation between rendered content and privileged operations. The alternatives are Tauri with the same React interface, a local backend opened in a browser through a graphical launcher, or a native toolkit.

Electron bundles Chromium and provides Node capabilities in main and utility processes.[^electron-processes] This gives Ohtia a controlled rendering baseline for long academic documents, citations, mathematics and multilingual input, while keeping the interface and local services in the TypeScript ecosystem. Tauri uses platform WebViews with a Rust core and can package Node services as sidecars.[^tauri-processes][^tauri-node] Electron is selected for its bundled rendering baseline and direct fit with Ohtia's application architecture.

The tradeoff is a larger distribution footprint and responsibility for updating the bundled runtime. Tauri trades the bundled browser for platform WebView dependencies and Rust/sidecar maintenance. A browser launcher adds lifecycle coordination between the browser and local services; a native toolkit requires a different interface and editing stack.

## Decision

Use Electron `45.0.*` with a [React](adr-0022-react-vite-renderer.md) and [strict TypeScript](adr-0002-typescript-product-and-local-ipc.md) renderer, a narrow preload bridge and a trusted main broker.[^electron-release] Put domain/storage services behind a supervised application-data-service boundary. The [system architecture](../architecture.md#process-and-trust-boundaries) and [frontend architecture](../frontend-architecture.md#electron-boundary) own the detailed contracts.

The renderer has no Node integration or direct database, filesystem, credential or process authority. Main validates IPC senders and dispatches named operations. Packaged content uses context isolation, renderer sandboxing and a restrictive CSP; untrusted documents cannot obtain the privileged bridge. These controls implement the product's containment requirements and follow Electron's documented guidance.[^electron]

## Consequences

One interface architecture serves the three desktop platforms. Ohtia distributes the runtime with the application and maintains Electron updates, packaging, signing and native integration. Startup, editing responsiveness and complete-process-tree resource use remain application quality requirements.

The privileged broker and supervised data service keep native authority outside the renderer. Renderer isolation does not confine arbitrary external executables; their containment follows the dedicated [content-processing decision](adr-0015-isolated-content-processing.md).

Test hostile rendered content, invalid IPC senders and privilege escalation alongside normal research journeys. Verify native dialogs, credential backends, input methods, child-process behavior and accessibility as part of desktop delivery.

[^electron]: Electron documents isolation, sandboxing, IPC validation and content restrictions; Ohtia must verify its own implementation.

[^electron-processes]: Electron's main and utility processes provide Node capabilities; the chosen renderer baseline does not eliminate OS-specific verification.

[^tauri-processes]: Tauri uses system WebViews, whose platform differences affect the verification matrix.

[^tauri-node]: Tauri can package Node services as sidecars without requiring a separate end-user Node installation.

[^electron-release]: The published package identifies the selected Electron line; runtime, native-module and packaging compatibility require their own conformance evidence.
