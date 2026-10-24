---
type: DecisionRecord
title: "ADR-0001 — One repository with explicit build boundaries"
description: "Use one repository and declared package interfaces while assembling compatible components into the desktop release."
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
---

# ADR-0001 — One repository with explicit build boundaries

## Context

UI, broker, data service, document processing and contracts change together. Separate repositories add cross-repository coordination; one undifferentiated package obscures privilege and dependency boundaries.

## Decision

Keep product code, tooling, contracts and documentation in this repository. Each package declares dependencies, public interfaces, verification and build outputs; dependencies are explicit and acyclic. Do not import another package's internals through filesystem paths. Domain logic does not depend on UI, packaging or a provider SDK.

Use workspaces and lockfiles per selected ecosystem. Shared packages contain genuinely shared contracts/behavior rather than placeholder services. A cross-process interface uses versioned runtime-validated messages, not shared object references. Packaging assembles the matching tested components into one installable application; an internal package does not require its own public release merely because it is a directory.

Changes to shared contracts, lockfiles or tools verify affected consumers; when the dependency scope is uncertain, verify the complete relevant set. Concrete directories and commands are introduced with working components, not empty scaffolding here.

## Consequences

Coordinated changes remain reviewable while runtime privileges and dependencies stay distinct. Clean-checkout builds must succeed without undeclared global tools. Build separation does not justify independently upgrading bundled components into incompatible combinations. [ADR-0021](adr-0021-versioned-desktop-artifacts.md) owns release identity and promotion.
