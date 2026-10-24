---
type: DecisionRecord
title: "ADR-0007 — Kysely, better-sqlite3 and exclusive migrations"
description: "Use Kysely with better-sqlite3 for typed SQLite access and reviewed migrations inside Ohtia's exclusive transaction and recovery boundary."
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
sources:
  - id: kysely-migrations
    resource: "https://kysely.dev/docs/migrations"
    title: "Kysely — Migrations"
  - id: kysely-migrator
    resource: "https://github.com/kysely-org/kysely/blob/v0.29.7/src/migration/migrator.ts"
    title: "Kysely — Migrator implementation"
  - id: kysely-sqlite
    resource: "https://github.com/kysely-org/kysely/blob/v0.29.7/src/dialect/sqlite/sqlite-adapter.ts"
    title: "Kysely — SQLite dialect adapter"
  - id: kysely-dialect
    resource: "https://kysely-org.github.io/kysely-apidoc/classes/SqliteDialect.html"
    title: "Kysely — Built-in SQLite dialect"
  - id: better-sqlite3-release
    resource: "https://github.com/WiseLibs/better-sqlite3/releases/tag/v13.0.3"
    title: "better-sqlite3 — Release metadata"
  - id: better-sqlite3-build
    resource: "https://github.com/WiseLibs/better-sqlite3/blob/v13.0.3/docs/compilation.md"
    title: "better-sqlite3 — Bundled SQLite and compilation"
  - id: better-sqlite3-api
    resource: "https://github.com/WiseLibs/better-sqlite3/blob/v13.0.3/docs/api.md"
    title: "better-sqlite3 — Native binding and backup API"
  - id: sqlite-rebuild
    resource: "https://www.sqlite.org/lang_altertable.html#making_other_kinds_of_table_schema_changes"
    title: "SQLite — Making other kinds of table schema changes"
---

# ADR-0007 — Kysely, better-sqlite3 and exclusive migrations

## Context

SQLite removes server administration, not the need for transactions, constraints and schema evolution. SQL spread through UI handlers hides domain atomicity; a generic CRUD repository per table can hide cross-table rules. The alternatives are direct driver queries, Drizzle ORM/Kit with schema declarations and generated migrations, or SQLAlchemy/Alembic with an additional Python product runtime.

Kysely provides typed SQL queries and a migration runner while allowing explicit, reviewed SQL for schema transitions. This fits the TypeScript data service without introducing object tracking or relying on a generated schema diff as the migration contract. Kysely owns migration ordering and execution history; Ohtia owns admission, compatibility, transaction safety and pre-migration recovery.

## Decision

### Query and repository boundary

Use Kysely `0.29.*` for database queries and the `Migrator` from the same package for schema migrations. Expose persistence through trusted repositories for domain aggregates and bounded read queries. Keep Kysely types, SQLite handles and SQL inside the application data service; renderer and domain command contracts do not depend on library-specific query types.

The application service owns each domain transaction; individual repositories do not independently commit effects that belong together. Use parameterized values and enforced foreign keys, unique/check constraints and version predicates, including UUID binary validation and same-manuscript revision ownership. Raw SQL is restricted to reviewed application statements, never accepted from rendered content, agents or research inputs.

### SQLite binding and packaged artifact

Use better-sqlite3 `13.0.*` as the native SQLite binding, passed to Kysely's built-in `SqliteDialect`.[^better-sqlite3-release][^kysely-dialect] Its synchronous database operations run in the supervised application data service, outside the renderer and main event loop. Kysely owns typed queries; better-sqlite3 supplies the SQLite connection and native operations.

Use the upstream release's bundled SQLite engine, satisfying the engine line owned by [ADR-0006](adr-0006-sqlite-application-storage.md). This selects the standard distribution rather than maintaining an Ohtia-specific SQLite amalgamation.[^better-sqlite3-build] Pin the exact binding patch and native artifact with the release; a binding patch whose embedded engine leaves that line is incompatible until the relevant ADR is explicitly updated. Updating Kysely alone changes neither binding nor engine.

Package the JavaScript wrapper and its matching native addon for each supported OS/CPU and runtime compatibility target, including the libc baseline where applicable. Use a compatible upstream native artifact, or build from the pinned upstream sources with their bundled SQLite when that target requires compilation. Keep the addon as an unpacked native file in the application's trusted installation resources. Resolve that exact file through `nativeBinding`; never accept its path from research content, an agent or a user-selected library directory.[^better-sqlite3-api]

Verify the loaded artifact and effective connection's engine identity under the packaged Electron utility process, as required by ADR-0006. A native-load or engine mismatch blocks normal data-service admission rather than falling back to an operating-system library, Node's built-in SQLite or a different artifact. Runtime updates repeat the affected native-loading and storage checks.

Use better-sqlite3's `backup()` API for the verified pre-migration checkpoint in [ADR-0010](adr-0010-pre-migration-recovery.md), preserving its quiescence, integrity, publication and recovery rules.[^better-sqlite3-api] All ordinary and migration connections obey the same foreign-key, ownership and transaction contracts.

### Packaged migrations and compatibility

Package a fixed, ordered registry of migration modules through a `MigrationProvider`; do not scan a user-selected directory or require an end-user CLI. Each module exports `up`, contains reviewed SQL/transforms and remains independent of mutable product models. Kysely supports a packaged provider without requiring separate migration files.[^kysely-migrations]

Use zero-padded sequential names such as `0001_initial`, preserving lexical order. Keep `allowUnorderedMigrations: false`. The release declares the exact target migration name, target SQLite `user_version` and supported source revisions. Invoke `migrateTo(targetName)` for that target; normal startup never invokes a downgrade. Migration modules do not issue their own transaction commands, change foreign-key enforcement, perform filesystem/network I/O outside the migration database or commit independently.

The packaged manifest records each migration name and a SHA-256 digest of its exact executable module bytes. Keep migration modules self-contained, with their reviewed SQL and transformation logic included in that artifact. Preserve published executable modules byte-for-byte in later packages; compiler or bundler updates must not regenerate historical migration artifacts. Store applied identities in `ohtia_migration_artifacts`, with `name TEXT PRIMARY KEY NOT NULL` and `sha256 TEXT NOT NULL` containing the full 64-character lowercase hexadecimal digest. Create and update this application-owned metadata in the same transaction as Kysely's execution history. Kysely retains ownership of its own history tables; Ohtia does not replace its sequencer or write those history rows itself.

Before creating a checkpoint or applying SQL, compare `user_version`, the ordered Kysely history and the stored artifact identities with the release's supported source and packaged manifest. Reject a newer or unsupported revision, a missing/reordered/modified applied migration, inconsistent metadata or an unexpected source shape that a rebuild would discard. A fresh empty database starts at revision zero with no migration metadata; missing artifact metadata alongside existing migration history is an error. If the database already matches the release target, validate compatibility without creating a migration checkpoint.

Kysely checks migration names and ordering, but its history records names and timestamps rather than content hashes, and it does not interpret Ohtia's `user_version` compatibility contract.[^kysely-migrator] Changing an applied migration requires a new migration instead of editing the historical module. The release and lockfiles pin exact package patches and artifacts; the manifest is not a substitute for release integrity.

### Exclusive transaction and execution

Kysely's SQLite adapter does not automatically wrap migrations in a DDL transaction and does not acquire a cross-process migration lock.[^kysely-sqlite] Ohtia supplies that boundary around the existing `Migrator`:

1. Obtain exclusive migration admission through the single broker and quiesce normal connections, writers and attempts. An exclusive SQLite write transaction alone does not exclude WAL readers. Complete the source/manifest checks and create the verified pre-migration checkpoint defined in [ADR-0010](adr-0010-pre-migration-recovery.md).
2. Reserve one dedicated Kysely connection for the complete transition. If the reviewed sequence rebuilds referenced tables, disable foreign-key enforcement on that connection before opening the transaction, following SQLite's rebuild procedure.[^sqlite-rebuild]
3. Issue `BEGIN EXCLUSIVE` on that reserved connection. Create any required application migration metadata inside this transaction. Pass the reserved connection to `Migrator` with `disableTransactions: true`: Ohtia owns the already-open transaction, while Kysely owns migration ordering, execution and history. Do not pass a Kysely `Transaction` object to this SQLite migrator; the adapter rejects that path.[^kysely-migrator]
4. Invoke the exact target and inspect `MigrationResultSet.error` and the expected pending-migration results. Migration methods return errors in the result instead of throwing them; convert any error or incomplete result into failure. A library result marked successful is not yet an Ohtia commit.[^kysely-migrator]
5. Record the applied artifact identities. Require `PRAGMA foreign_key_check` to return no rows and `PRAGMA integrity_check` to return only `ok`, then verify the target schema and domain invariants before commit. Preserve references, indexes, checks and complete content during table rebuilds. Set the explicit target `user_version` inside the same transaction.
6. Commit only after all checks pass. On any earlier failure, roll back the complete transaction, including DDL, data and both migration metadata sets. Restore and verify foreign-key enforcement before permitting normal commands; close the connection and block normal opening if that cannot be established. Post-commit failures follow the checkpoint recovery contract rather than pretending a committed transaction can still be rolled back.

Only this migration path owns the reserved connection during the transition. No window, task, callback or other command may interleave work on it. Failure or interruption blocks normal opening and preserves the checkpoint and failed-state evidence for explicit retry or verified recovery. Never silently drop unknown fields, mark partial progress as a completed schema or automatically restart external attempts.

For incompatible changes, preserve the expand/migrate/contract principle where persisted data or pending jobs require it; the single installed app can instead perform a verified exclusive transition when safe. Long transformations retain bounded work and recovery without committing an incomplete target schema as usable. General backup management remains outside this migration contract.

## Consequences

The standard binding distribution avoids a separately maintained SQLite amalgamation, while native artifact packaging and runtime compatibility remain release responsibilities. Typed queries and schema evolution remain reviewable within the TypeScript product. Kysely supplies the query builder and migration runner; Ohtia maintains the transaction, manifest checks and application lifecycle around them. SQL migrations and TypeScript database types must remain aligned through storage checks. There is no automatic schema push or unreviewed generated migration at startup.

Verify UUID blobs, complete TEXT revisions, initial circular draft/revision creation, rollback and backup integration through the packaged binding. Cover empty installs, populated upgrades, repeat opening, changed or missing migration artifacts, incompatible newer schemas, migration-result errors, foreign-key violations, interruption, concurrent startup and disk-full. Assert that failures preserve both domain state and migration metadata, and that normal commands remain blocked until recovery is resolved. These requirements apply to the delivered implementation rather than being established by selecting a library.

[^kysely-migrations]: Kysely documents independent migration modules, ordered execution and custom providers; Ohtia selects reviewed packaged modules.

[^kysely-migrator]: The runner exposes explicit targets and result errors and maintains name/timestamp history; Ohtia adds artifact identity and schema compatibility checks.

[^kysely-sqlite]: The SQLite adapter declares nontransactional migration DDL and no-op migration-lock methods; Ohtia supplies explicit transaction ownership and broker exclusion.

[^sqlite-rebuild]: SQLite's generalized rebuild procedure changes foreign-key enforcement before the transaction and checks references before commit.

[^kysely-dialect]: Kysely's built-in SQLite dialect accepts a better-sqlite3 database connection.

[^better-sqlite3-release]: The upstream release identifies the binding package; its version is independent of the SQLite engine and Kysely.

[^better-sqlite3-build]: Upstream documents the SQLite engine and compilation options bundled in this release, separately from its custom-amalgamation mechanism.

[^better-sqlite3-api]: The binding exposes explicit native-addon selection and an online backup API; Ohtia fixes the trusted artifact path and checkpoint lifecycle.
