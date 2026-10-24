---
type: DecisionRecord
title: "ADR-0006 — SQLite application storage"
description: "Store structured records and manuscript revisions in ohtia.db3, with retained binary files in the managed object directory."
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
sources:
  - id: sqlite
    resource: "https://www.sqlite.org/whentouse.html"
    title: "SQLite — Appropriate uses"
  - id: release
    resource: "https://www.sqlite.org/changes.html"
    title: "SQLite — Release history"
  - id: identity
    resource: "https://www.sqlite.org/lang_corefunc.html"
    title: "SQLite — Core functions"
---

# ADR-0006 — SQLite application storage

## Context

Ohtia needs durable local transactions, relational constraints and schema evolution without administering a database server. A filesystem of independently editable metadata/manuscript files would require synchronization across those records. SQLite is intended for application-local persistence.[^sqlite]

The product definition owns the research scope. This record selects persistence technology, the database filename and the engine version; it does not assign product capabilities to the database engine.

## Decision

### Database file and owner

The application database is `<ohtia-data>/ohtia.db3`. `ohtia.db3` is the fixed filename; it does not contain a project title, source name, application release or schema version. `<ohtia-data>` is the application data directory selected through the architecture's native-path rules.

Only the trusted application data service opens the operational database. Renderer, parsers and inference agents use scoped application commands rather than receiving its path or SQL access. A database connection enables `PRAGMA foreign_keys = ON` and verifies it before serving commands; constraints are not optional checks in the UI.

### Engine version and effective runtime

Use SQLite `3.53.*` as the application database engine.[^release] Access it through the better-sqlite3 binding selected in [ADR-0007](adr-0007-sqlite-repositories-and-migrations.md#sqlite-binding-and-packaged-artifact). The packaged build must demonstrate compatibility with a pinned patch in this line before storage is enabled.

The selected driver must identify the engine it actually embeds. Record `sqlite_version()`, `sqlite_source_id()` and compilation options from the packaged data-service connection and verify required behavior there.[^identity] An operating-system SQLite CLI version does not identify that embedded engine. A binding outside the selected version line does not satisfy this decision. Patch updates within the line require reviewed build pins and affected verification; changing the selected line also requires a reviewed update of this ADR.

The application schema revision is independent of SQLite's engine version and the Ohtia release. Lock the actual engine/binding artifacts in build configuration when storage is implemented; never resolve an unqualified latest engine at app startup.

### Stored data and transaction boundary

Persist structured records, relationships, workflow history and complete Markdown manuscript revisions in SQLite. `draft_revisions.markdown` is `TEXT`; `drafts.current_revision_id` identifies current manuscript content. Insert the revision and advance that pointer in one transaction after checking the expected predecessor. Editor JSON is derived, and generated Markdown files are outputs.

Retain original PDFs, images and binary attachments under `objects/`, according to [ADR-0009](adr-0009-managed-imported-files.md). SQLite stores their asset identities, SHA-256 hashes, byte lengths, media types and relationships. Do not put the binary originals into the manuscript column or make a second editable manuscript file authoritative.

[Architecture](../architecture.md#application-data-authority) defines service ownership and [the data model](../data-model.md) defines entity fields and relationships. [ADR-0007](adr-0007-sqlite-repositories-and-migrations.md) owns repository/migration rules; [ADR-0010](adr-0010-pre-migration-recovery.md) owns pre-migration recovery.

## Consequences

The storage contract fixes a database name and separates transactional text/records from retained bytes. Test initial creation, constraints, UUID BLOBs, stale saves, rollback, disk-full and recovery through the actual binding. Engine, driver, app and schema versions remain separately identifiable. [ADR-0007](adr-0007-sqlite-repositories-and-migrations.md) selects the binding, query layer and migration runner. The packaged binding must satisfy that interface and this engine contract; its packaged artifact identifies the actual SQLite build.

[^sqlite]: SQLite documents application-local persistence as an intended use; Ohtia's storage split is its own decision.

[^release]: SQLite's release history identifies published engine builds; availability is not Ohtia compatibility.

[^identity]: SQLite documents the engine version/source identity functions. Compilation options and behavior are checked on the connection used by Ohtia.
