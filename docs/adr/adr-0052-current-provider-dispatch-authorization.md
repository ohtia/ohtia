---
type: DecisionRecord
title: "ADR-0052 — Current authorization for provider dispatch"
description: "Authorize every application-controlled provider transfer with current scope, committed single-use permits and bounded zero-dispatch readmission."
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
---

# ADR-0052 — Current authorization for provider dispatch

Supersedes [ADR-0028 — Current authorization for mediated provider transfers](adr-0028-mediated-provider-transfers.md). This record owns authorization at the provider-transfer boundary; [ADR-0051](adr-0051-research-agent-task-execution.md) owns the task and attempt lifecycle.

## Context

Ingestion-time permission and prompt instructions cannot control a later tool result, fallback or retry. Conversely, keeping database locks across network calls damages recovery and cannot establish the instant bytes leave. Agent runtimes can own internal requests that Ohtia cannot individually observe. Alternatives are authorization only at ingestion, cached startup permission, or a current admission check for each application-controlled dispatch. The first two retain stale authority after restrictions change; per-dispatch admission supplies an explicit consistency point while acknowledging the limits of already transmitted bytes and runtime-owned calls.

A permit can expire or a session renewal can reject a request before anything leaves Ohtia. Treating that case like an already dispatched retry consumes the wrong policy budget. Durable dispatch evidence and one bounded readmission preserve the researcher's existing acceptance while keeping uncertain dispatch out of automatic repetition (PRIN-002, PRIN-004 and PRIN-006).

## Decision

Route Ohtia-controlled research transfers through one application admission boundary checking active connection, project, immutable inputs, current restrictions, operation, attempt and budgets. Include prompts, attachments, retrieved passages, tool results and explicit retries. Record a private input manifest and omissions; operational logs exclude the content.

Complete capacity waits before admission. Commit authorization and the manifest in a short transaction, serialized with restriction/cancellation changes, and perform network work afterward. A confirmed restriction/cancellation before admission blocks it. Later changes block following admissions; they cannot recall transmitted bytes.

For directly controlled HTTPS adapters, use short-lived single-dispatch permits and guards before invoking the SDK and before releasing the body through a supported transport hook. The initial two-second validity is a versioned parameter requiring measured validation, not a response deadline or physical transmission guarantee. Use verified suspend-aware timing or invalidate on sleep/resume; do not silently use a clock that loses suspension time. Observed expiry/revocation blocks dispatch. No permit extension, replay, hidden retry or silent redirect is allowed. Proven zero dispatch permits one complete readmission within the operation's `max_attempts`, which does not count against its `max_auto_retries`; uncertain dispatch does not.

For a provider request controlled by main, the data service writes `dispatch_permitted_at` and the immutable transfer manifest in the transaction issuing the permit, commits, and only then posts `provider_dispatch` to main. Clear that timestamp in the same transaction that records main’s proven not-dispatched result with `permit_expired`, `connection_expired` or `provider_unavailable`. Only an empty value proves zero dispatch. A crash after the commit and before the send leaves a set value and follows dispatched-attempt recovery. Readmission revalidates current authorization, retains the task's original budget and reply reservation, and obeys [ADR-0051's attempt and coalescing rules](adr-0051-research-agent-task-execution.md#scheduling-and-required-limits). It never authorizes a hidden transport retry.

An agent adapter admits a bounded authorized agent action and declares the runtime controls it can prove. It must not claim per-HTTPS guards for internally owned provider calls it cannot observe. Unsupported containment leaves the operation unavailable. External data treatment follows the [architecture](../architecture.md#transfers-credentials-and-privacy); account access and consent are not inferred from a provider name.

## Consequences

Admission has a clear consistency point and preserves incomplete/unknown outcomes. Test changed restrictions, cancellation races, delayed connections, stale attempts, suspend/resume, tool-result egress and fallback. A pause after the last guard and already buffered bytes remain limits; do not promise instantaneous revocation or a physical network cutoff. Every enabled access mode needs its own declared provider-policy evidence. Test the commit-before-send crash window, permit expiry before and after renewal, recorded non-dispatch and rejection of reused permits. A conservative dispatch timestamp can classify an unsent request as possibly dispatched; that preserves uncertainty instead of risking duplicate external work.
