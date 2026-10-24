---
type: DecisionRecord
title: "ADR-0028 — Current authorization for mediated provider transfers"
description: "Authorize each Ohtia-controlled transfer against current restrictions and scope without holding database transactions over the network."
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
---

# ADR-0028 — Current authorization for mediated provider transfers

## Context

Ingestion-time permission and prompt instructions cannot control a later tool result, fallback or retry. Conversely, keeping database locks across network calls damages recovery and cannot establish the instant bytes leave. Agent runtimes can own internal requests that Ohtia cannot individually observe.

## Decision

Route Ohtia-controlled research transfers through one application admission boundary checking active connection, project, immutable inputs, current restrictions, operation, attempt and budgets. Include prompts, attachments, retrieved passages, tool results and explicit retries. Record a private input manifest and omissions; operational logs exclude the content.

Complete capacity waits before admission. Commit authorization and the manifest in a short transaction, serialized with restriction/cancellation changes, and perform network work afterward. A confirmed restriction/cancellation before admission blocks it. Later changes block following admissions; they cannot recall transmitted bytes.

For directly controlled HTTP adapters, use short-lived single-dispatch permits and guards before invoking the SDK and before releasing the body through a supported transport hook. The initial two-second validity is a versioned parameter requiring measured validation, not a response deadline or physical transmission guarantee. Use verified suspend-aware timing or invalidate on sleep/resume; do not silently use a clock that loses suspension time. Observed expiry/revocation blocks dispatch. No permit extension, replay, hidden retry or silent redirect is allowed. Proven zero dispatch permits a complete readmission within the operation's single retry budget; uncertain dispatch does not.

An agent adapter admits a bounded authorized agent action and declares the runtime controls it can prove. It must not claim per-HTTP guards for internally owned provider calls it cannot observe. Unsupported containment leaves the operation unavailable. External data treatment follows [product](../architecture.md#transfers-credentials-and-privacy); account access and consent are not inferred from a provider name.

## Consequences

Admission has a clear consistency point and preserves incomplete/unknown outcomes. Test changed restrictions, cancellation races, delayed connections, stale attempts, suspend/resume, tool-result egress and fallback. A pause after the last guard and already buffered bytes remain limits; do not promise instantaneous revocation or a physical network cutoff. Every enabled access mode needs its own declared provider-policy evidence.
