---
type: DecisionRecord
title: "ADR-0018 — Vitest and Playwright with explicit runtime coverage"
description: "Use Vitest for pure/component tests and Playwright for browser and Electron journeys with complete declared inventories."
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
sources:
  - id: vitest
    resource: "https://vitest.dev/guide/"
    title: "Vitest — Guide"
  - id: electron
    resource: "https://playwright.dev/docs/api/class-electron"
    title: "Playwright — Electron"
---

# ADR-0018 — Vitest and Playwright with explicit runtime coverage

## Context

Pure logic, browser layout and Electron privileges need different evidence. Running the same HTTP assertion in several engines adds no rendering evidence, while testing a browser alone cannot prove packaged IPC or native lifecycle. Sampling rules tied to old authentication pages cannot be transplanted to a desktop that has none.

## Decision

Use Vitest `5.0.*` for unit/component contracts and Playwright `1.64.*` for browser/desktop journeys, with exact patches paired to their runtime dependencies. Playwright's Electron automation is documented as experimental; verify its support against the packaged Electron version rather than assuming it behaves like an ordinary browser.[^vitest][^electron]

Run the actual Electron artifact for preload, IPC, permissions, process lifecycle, installation-sensitive assets and native-boundary journeys. Use Chromium/Firefox/WebKit for separately declared portable DOM/editor/content suites when they test cross-engine behavior; those runs do not establish Safari, Windows, macOS or the installed Electron runtime. Scope every inventory explicitly. Do not copy the old web matrix's three-engine requirement into claims about native desktop coverage.

Pure data/HTTP assertions can run once when no helper/assertion depends on layout, focus, input, CSP enforcement, accessibility or another engine behavior. Visual locale/theme sampling requires an explicit inventory-specific decision and acknowledged omissions; old access-page filters and seven web-specific theme matrices do not authorize filtering new desktop tests. Baseline locale/theme suites cover their declared combinations until evidence justifies a narrower policy.

Keep packaged CSP active; unexpected violations fail tests and deliberate negative tests identify expected violations exactly. Detect missing, failed, skipped or cancelled required cases. Deterministic shards must have a union exactly matching the declared inventory with consistent local/CI commands. Preserve the [coverage and behavior gates](adr-0016-shared-quality-and-coverage-gates.md).

## Consequences

The suite distinguishes what each runtime can prove and maintains complete result accounting. Do not inherit measured old-web timing or savings. Native IME, clipboard and assistive behavior require actual OS journeys; synthetic events and a browser's accessible tree are narrower evidence. A frontend suite needs no real inference or private corpus.

[^vitest]: Vitest supplies unit/component tooling; Ohtia defines scope and required results.

[^electron]: The API documents experimental Electron support and its launch interface; compatibility must be demonstrated.
