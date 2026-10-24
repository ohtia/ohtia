---
type: DecisionRecord
title: "ADR-0029 — Versioned operation profiles and bounded usage reporting"
description: "Select permitted model capabilities per operation and retain partial or late consumption without granting stale research authority."
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
---

# ADR-0029 — Versioned operation profiles and bounded usage reporting

## Context

Hard-coded model names and automatic fallback obscure quality, restrictions and cost. Connected agents can hide provider subcalls or omit usage, and usage may arrive after cancellation. Dropping it loses provenance; keeping ordinary write authority permits stale effects.

## Decision

Each operation has a versioned policy naming enabled connection/access mode, required capabilities, permitted model/effort/options where controllable, input/output/work limits, prompt/schema versions, timeouts and the single total retry budget. The required numeric fields and cumulative attempt/retry limits are defined by [ADR-0011](adr-0011-bounded-durable-local-tasks.md#scheduling-and-required-limits). User changes remain within the operation's evaluated constraints. Record requested configuration and effective model/runtime values actually observed; unknown values remain unknown and mutable aliases are not immutable versions.

Adapters preserve complete/partial/truncated/error and tool-request distinctions. A fallback must be declared, enabled, capability-compatible, restriction-compatible and explicitly authorized for its destination. Neither SDK nor task layers add hidden retries. Agent ports retain their lifecycle rather than being reduced to a plain completion client; a small model-call port can live inside an adapter, with provider types kept internal.

Retain usage as reported counters, estimates or unknown, identifying their provenance. Late settlement is a separate append-only command bound to the original admitted invocation/attempt capability; it cannot read a newer attempt, change content, permissions or research decisions. Usage acceptance remains open during the admitted attempt. The late-report window lasts 900 seconds from the broker's first recorded invocation-terminal outcome or transition that closes or quarantines the attempt, whichever occurs first; requesting cancellation alone does not start that window. Persist the reporting deadline independently of execution authority, and never reset it on restart or retry. Verify the packaged runtime's clock/sleep behavior; inability to establish expiry requires reconciliation, not an assumed extension. Reporting never revives execution authority. Identical report replay returns the receipt, conflicting content at the same report revision fails, and a correction advances that revision. Unknown is not zero.

For agent-owned usage that cannot be observed or reliably attributed, declare the limit instead of claiming a per-provider billing ledger. Reuse results only when exact input/configuration, current restrictions and provenance allow it; reuse does not transfer human confirmation between projects.

## Consequences

Operations become auditable without promising exact cost control over opaque runtimes. Evaluate selected operations/languages before enabling them; transport conformance does not establish research quality. Test missing usage, partial streams, disabled/revoked connections, stale attempts, late reports, conflict/replay and unauthorized fallback. Usage reports are adapter assertions, not signed provider invoices.
