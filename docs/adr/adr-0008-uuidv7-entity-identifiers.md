---
type: DecisionRecord
title: "ADR-0008 — Application-generated UUIDv7 entity identifiers"
description: "Generate internal entity UUIDv7 identifiers in the trusted data service and store them as 16-byte SQLite blobs."
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
sources:
  - id: rfc
    resource: "https://www.rfc-editor.org/rfc/rfc9562.html"
    title: "RFC 9562 — Universally Unique IDentifiers"
  - id: sqlite-types
    resource: "https://www.sqlite.org/datatype3.html"
    title: "SQLite — Datatypes"
---

# ADR-0008 — Application-generated UUIDv7 entity identifiers

## Context

Research entities need stable identities independent of titles, citekeys, file paths and database row positions. The trusted application can assign an identity before persistence and preserve it through the [pre-migration checkpoint and recovery](adr-0010-pre-migration-recovery.md). Any later interchange contract must preserve the same identity rather than reallocating it. The [data model](../data-model.md) defines entity ownership; this record selects their internal identifier mechanism.

Database-assigned integers are compact but tie allocation to a database operation. UUIDv4 supports application-side allocation but has randomly distributed values. UUIDv7 combines local allocation with a leading Unix-millisecond timestamp, favoring temporal index locality without a central sequence.[^rfc] This is a design rationale, not a measured Ohtia performance result.

SQLite provides `TEXT` and `BLOB` storage classes rather than a native UUID type.[^sqlite-types] Text UUIDs are easier to inspect directly; binary UUIDs retain the same identity in fewer value bytes and avoid multiple textual spellings inside the database.

## Decision

Use UUIDv7 for internal entity primary keys and their foreign-key references. The trusted application data service generates new identities before insertion using an RFC 9562 conforming implementation. Do not depend on a SQLite extension or renderer/model-supplied identity generation. Select the actual library with its implementation and conformance checks rather than declaring an untested package here.

Store each UUID as exactly 16 bytes in RFC network byte order in a SQLite `BLOB`. Primary keys are explicitly non-null and unique. Physical schema constraints validate storage class, byte length, version 7 and the RFC variant; referenced columns use the same encoding. Do not assume that declaring a column `UUID` or `BLOB(16)` enforces these requirements.

At textual boundaries, use the lowercase, hyphenated 36-character form with groups 8-4-4-4-12. Validate the canonical spelling, version and variant before conversion. Reject invalid input rather than silently changing bits or assigning a different identity. Existing identities read from retained database snapshots or any supported import are validated and preserved; they are not regenerated on opening. This identity rule does not introduce a general backup manager or an interchange serializer.

External identifiers such as DOI and provider thread IDs, bibliography citekeys, content hashes and manuscript block identities retain their own contracts. Operation idempotency remains a separate command contract. A UUID's embedded timestamp is neither an explicit save time nor an authorization capability; retain observed timestamps and ownership checks separately.[^rfc]

## Consequences

Entity identity remains independent of the database engine and can be allocated before insertion. Binary values need conversion for diagnostics and interchange and occupy more value bytes than small integers. UUIDv7 exposes approximate generation time and must not be treated as secret.

Do not infer a total operation order, revision predecessor, exact creation time or cross-process monotonicity from UUID order. Clock adjustments and concurrent generators do not replace explicit revision links or ordering fields. A uniqueness violation fails the write; it never authorizes overwriting an existing entity.

Implementation verification covers generation, canonical text/binary round trips, network byte order, restart/concurrency, foreign-key consistency and preservation through the defined pre-migration checkpoint/recovery path. Reject nulls, wrong storage classes or lengths, other UUID versions, incorrect variants and noncanonical textual inputs. Verify database constraints independently of application validation. Reconsider the representation only with a justified migration that preserves identities.

[^rfc]: RFC 9562 defines UUID layout, UUIDv7, sorting, timestamp considerations and security limits in sections 4, 5.7, 6.1, 6.11 and 8. Application allocation, canonical spelling and Ohtia's identity scope are local decisions.

[^sqlite-types]: SQLite documents its storage classes and type-affinity rules. The binary UUID encoding and schema validation requirements are Ohtia's contract.
