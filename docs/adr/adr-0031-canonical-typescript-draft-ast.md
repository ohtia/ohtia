---
type: DecisionRecord
title: "ADR-0031 — One TypeScript draft parser and versioned AST"
description: "Keep academic Markdown interpretation and serialization in one trusted TypeScript module with AST exchange at the editor boundary."
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
---

# ADR-0031 — One TypeScript draft parser and versioned AST

## Context

A generic Markdown library's default extensions do not implement Ohtia's identity and fidelity rules. Maintaining independent Python and browser parsers would duplicate interpretation. In this desktop the trusted data service is TypeScript, so the web predecessor's reason for a Python-only canonical parser no longer applies.

## Decision

Implement the academic profile in one [TypeScript](adr-0002-typescript-product-and-local-ipc.md) parser/validator/serializer module owned by the trusted data service. The editor exchanges the versioned typed document AST and diagnostics through its boundary; it does not make ProseMirror JSON the persisted manuscript or maintain a second Markdown interpretation.

On open, parse the exact retained revision. On save, validate the received AST, identities/resources and expected revision, serialize deterministically, parse it again and compare semantic structure before committing its Markdown TEXT and current pointer atomically. Preserve a recoverable editor buffer on rejection. Source views and imports use the same profile implementation.

Use explicit size/depth/work limits and an exact academic grammar; generic libraries may supply bounded primitives but cannot silently expand the profile. Do not run Pandoc's general Markdown reader in the save path. Export converts the validated AST to writer input, rather than re-reading Markdown with another grammar. Define conversions, unresolved-reference diagnostics and identity rules together with [Draft format](../draft-format.md).

Verify parse/serialize/parse semantic identity, deterministic/idempotent serialization, random valid ASTs, adversarial/fuzz input and bounded runtime. Differential tests can compare a declared syntax subset to a pinned external reader; they cannot delegate Ohtia's identity contract to that reader.

## Consequences

One implementation keeps save, anchoring and delivery aligned but Ohtia must maintain its grammar, AST schema and converters. Previous Python parser timings/corpus passes do not validate a new TypeScript implementation. Measure long manuscripts and record unsupported constructs without discarding them. Reconsider if a maintained compatible full-profile implementation becomes available.
