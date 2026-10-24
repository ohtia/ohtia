---
type: DecisionRecord
title: "ADR-0015 — Restricted processes for untrusted content"
description: "Process imported content in disposable environments without database, credential or general filesystem authority."
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
---

# ADR-0015 — Restricted processes for untrusted content

## Context

PDFs, images and supervisor documents can be malformed, active or resource-exhausting. Checking an extension or MIME type does not make their parsers trustworthy. Running them inside the data service would expose all projects. A child process without enforced resource and access controls is not sufficient isolation.

## Decision

Execute parsers and converters in restricted disposable processes. Give each only authorized immutable input bytes, validated options and its own scratch output location. Deny general data-store/home access, credentials, arbitrary network and database connections. Separate privileged broker, data service, parser, agent and migration responsibilities; a shared OS account is not equivalent to database roles or an OS sandbox.

Enforce bounds for CPU, memory, wall time, input/output, nesting and decompressed volume. Disable document scripts, macros, includes and remote resource resolution. Authorized URL acquisition is a separate component with destination/redirect and internal-network controls. Validate parser output structure, size, source/project binding and provenance before persistence. Preserve originals and distinguish partial extraction from complete examination.

Demonstrate the OS-specific confinement mechanism before enabling the processor. Migration and cleanup operations use trusted scoped commands and never become parser capabilities. [Architecture](../architecture.md#process-and-trust-boundaries) owns process placement; [ADR-0009](adr-0009-managed-imported-files.md) owns retained-file import.

## Consequences

Containment adds packaging and platform verification work while limiting a parser compromise. Test malformed and expansion-heavy files, forbidden reads/network, inherited environment, timeouts, oversized output and cleanup after crashes. Re-evaluate before granting a format additional capabilities. No AWS roles, PostgreSQL RLS or developer-installed Docker are prerequisites for the installed app.
