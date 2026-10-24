---
type: DecisionRecord
title: "ADR-0012 — Capabilities bound to one supervised attempt"
description: "Bind worker effects to a random per-attempt capability and reject replay or stale scope through the trusted broker."
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
---

# ADR-0012 — Capabilities bound to one supervised attempt

## Context

Project, job and attempt IDs identify work but are not secret proof of authority. A compromised process that can declare another attempt must not gain that attempt's inputs or effects. SQLite does not provide the old PostgreSQL role/RLS/function mechanism, so the local broker must enforce the boundary.

## Decision

When claiming a task, generate a fresh 256-bit cryptographically random secret bound to the immutable job/project/attempt identity. Give it only through the attempt's private channel, not logs, command arguments or inherited environment. Retain only the scoped verification digest in trusted task state; identifiers or a model-supplied scope never substitute for the capability.

Every tool/read/proposal/result command resolves identity from trusted attempt state and validates the secret, current generation, lease/deadline where applicable, cancellation and expected input versions. Research effects require the task/attempt execution states allowed by [ADR-0011](adr-0011-bounded-durable-local-tasks.md); cancellation or uncertainty revokes that authority. Workers have no raw SQLite path or general SQL grant. A new claim replaces execution authority; an old process cannot finalize, audit or write a newer attempt. Constant-time secret validation and digest handling are implementation requirements, not an authorization bypass through error paths.

Navigator and other domain tools call the same trusted application rules as human routes but expose only their explicitly allowed reading/proposal subset. They cannot confirm/reject as a human, supply reviewer identity, execute arbitrary queries or widen stage/evidence scope. Confirmations remain separate UI commands. Tool correlation/idempotency and restrictive read projections are defined with the feature before enabling it.

Keep late usage settlement separate under [ADR-0029](adr-0029-operation-profiles-and-usage-reports.md). A secret for a terminated attempt can authorize only that bounded receipt, never renewed research effects. A lease expiring does not prove process termination or stop remote billing.

## Consequences

Attempt spoofing becomes a tested broker property rather than a prompt promise. Test known IDs without secrets, wrong-attempt secrets, replay, replacement claims, stale evidence, cancellation races and attempts to emit human confirmations. Per-attempt secrets do not sandbox processes sharing OS access; verify native containment separately and keep secrets out of diagnostics.
