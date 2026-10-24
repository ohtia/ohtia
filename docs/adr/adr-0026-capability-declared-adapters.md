---
type: DecisionRecord
title: "ADR-0026 — Capability-declared adapters with explicit access modes"
description: "Keep inference and search integrations behind distinct contracts with verified capabilities and account access."
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
---

# ADR-0026 — Capability-declared adapters with explicit access modes

## Context

Providers differ in authentication, subscriptions, tooling, streaming, interruption, search coverage and usage reporting. A common interface that silently emulates missing features can conceal cost, permissions and incomplete evidence. A provider-neutral model client alone does not describe the lifecycle of a full agent.

Alternatives are provider SDK calls throughout the application, a generic framework deciding execution policy, or small internal ports with explicit adapter capabilities. The common choice is capability admission; inference and search retain separate operations rather than sharing an artificial request/response schema.

## Decision

Use two distinct application-owned adapter families:

- **Inference-agent adapters** integrate supported agent runtimes and programmatic inference surfaces, including their execution, tools, streaming and interruption lifecycle. Model selection is one capability within that contract.
- **Search adapters** cover academic search engines, bibliographic databases and scholarly indexes, including their permitted public, API and authenticated access modes.

These families integrate external research providers. SQLite drivers and other internal storage integrations follow the persistence decisions, including [ADR-0007](adr-0007-sqlite-repositories-and-migrations.md), rather than the research-provider adapter contract.

Use inference-agent and search ports with adapter identity/version, supported access modes, effective capabilities and classified failures. Keep provider SDK/protocol types inside the adapter. Preserve typed requests, stream events, tool requests, completion reasons, reported usage and classified partial errors; a small direct-model client can live inside an adapter without replacing the full agent lifecycle. [Operation profiles](adr-0029-operation-profiles-and-usage-reports.md) select permitted settings and one retry budget across layers. The [inference](../architecture.md#inference-agent-adapter-contract) and [search](../architecture.md#search-adapter-contract) contracts define their different lifecycles.

Activation requires a compatible runtime/access route and the operation's effective controls. Disable new dispatch through a disabled connection. Never infer subscription access, anonymous querying or full-text permission from a provider name, successful login or public website. A failed mode does not silently switch identity, provider or method.

## Consequences

Provider replacement and deterministic testing do not require rewriting research logic. Each integration still needs maintenance, versioned conformance and its own access review. Capability compatibility does not establish equal linguistic or reasoning quality.

Test partial streams, missing fields, unsupported controls, unknown consumption, account revocation, disabled connections, pagination gaps and explicit fallback behavior. Preserve per-provider provenance when aggregating search and require user authorization before a new destination receives research material.
