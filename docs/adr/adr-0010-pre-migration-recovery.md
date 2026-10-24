---
type: DecisionRecord
title: "ADR-0010 — Pre-migration database recovery"
description: "Preserve data, schema and migration metadata in a verified SQLite checkpoint for upgrade recovery."
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
sources:
  - id: sqlite-backup
    resource: "https://www.sqlite.org/backup.html"
    title: "SQLite — Backup API"
---

# ADR-0010 — Pre-migration database recovery

## Context

A new Ohtia release can need a database-schema migration. A failed or interrupted transformation must not destroy the last usable database state. Merely copying the active database file can omit journaled state; SQLite provides a supported backup mechanism for a consistent database snapshot.[^sqlite-backup]

This record covers the internal safety copy and recovery associated with an Ohtia schema upgrade. It does not introduce a general-purpose backup/restore feature for the researcher. A release without a schema migration does not create a checkpoint just because its app version changed.

## Decision

### Scope and checkpoint files

Before applying the release's required migration sequence, create a checkpoint under:

```text
<ohtia-data>/recovery/migrations/<operation-id>/
  ohtia.db3
  manifest.json
```

`operation-id` is an application-generated UUID. `ohtia.db3` is the complete database snapshot immediately before the migration sequence: research data, schema, SQLite `user_version`, Kysely migration history and `ohtia_migration_artifacts` remain together. A fresh revision-zero database has no migration metadata, following [ADR-0007](adr-0007-sqlite-repositories-and-migrations.md#packaged-migrations-and-compatibility). Credentials and provider login state are excluded.

`manifest.json` records the operation, source/target schema revisions, source/target migration names, the ordered pending migration names and artifact SHA-256 digests, app release, effective SQLite version/source ID, snapshot SHA-256/byte length and retained object identities referenced by the snapshot. The source migration name is null for revision zero. These identities bind the checkpoint to the exact reviewed transition; the snapshot retains the applied history and artifact metadata that identify its source state.

Original files remain immutable in `objects/`; the checkpoint does not recursively copy the library. Prevent cleanup of referenced objects while the checkpoint is retained. A schema migration cannot modify or remove those retained bytes. A change that must transform the managed file format needs its own reviewed recovery procedure before it is run.

### Creation and migration

1. Obtain exclusive migration access through the single broker and quiesce normal database connections, writers and outstanding attempts. Complete the source-schema, history and artifact-compatibility checks in [ADR-0007](adr-0007-sqlite-repositories-and-migrations.md#packaged-migrations-and-compatibility) before creating the checkpoint. If exclusion or compatibility cannot be established, block the transition. Keep normal database access and new external attempts blocked throughout checkpoint creation, migration and recovery.
2. Before opening the migration transaction, use the better-sqlite3 `backup()` API selected in [ADR-0007](adr-0007-sqlite-repositories-and-migrations.md#sqlite-binding-and-packaged-artifact) to create the snapshot in `<operation-id>.partial`. Complete the manifest and flush the files. Verify the snapshot digest and byte length, require `PRAGMA integrity_check` to return only `ok` and `PRAGMA foreign_key_check` to return no rows, and check that its schema revision and migration metadata match the declared source. A failed checkpoint blocks migration and leaves earlier valid checkpoints intact.
3. Atomically publish the checkpoint directory only after verification. Then apply the explicit target through Kysely's Migrator inside the transaction and compatibility boundary defined by [ADR-0007](adr-0007-sqlite-repositories-and-migrations.md#exclusive-transaction-and-execution). Do not create new checkpoints from a partly migrated database and call them valid pre-upgrade state.
4. Complete the target-schema and integrity checks, commit Ohtia's outer transaction and restore verified foreign-key enforcement as required by ADR-0007 before enabling normal database access. A successful Kysely result is an intermediate result, not confirmation of that commit. Retain the latest verified pre-migration checkpoint. A later successful upgrade can replace older resolved checkpoints after its new checkpoint is verified; unresolved failed-upgrade checkpoints are retained until recovery is resolved.

### Failure and recovery

If migration fails or is interrupted, keep normal database access blocked and show the update/recovery failure. Do not discard unknown fields, open partial schema as healthy or automatically restart external tasks. Keep the verified checkpoint and preserve the failed database state for the recovery procedure.

For a failure before commit, roll back the open migration transaction through ADR-0007's execution boundary. Confirm that data, schema, `user_version` and both migration metadata sets still match the source before an explicit retry. A confirmed rollback preserves the source database without requiring replacement from the checkpoint.

After a commit, rollback cannot undo that committed transition. After an interruption or uncertain commit outcome, inspect the actual database and its migration metadata to establish whether the complete source or target state is present; a Kysely result or missing completion message cannot establish that outcome. Keep the recovery gate closed until a verified retry, compatible target reopening or checkpoint restoration is selected. Inconsistent or unreadable state is not admitted as a usable schema.

To restore pre-migration data, close all database connections and verify the checkpoint digest, integrity, source revision and migration identities against its manifest and the selected compatible app path. Materialize it into a separate temporary database and validate that database before activation. Restore research data, schema, `user_version`, Kysely history and `ohtia_migration_artifacts` as one database snapshot; never restore individual history tables, rewrite history rows or invoke Kysely downgrade methods to simulate recovery. Preserve the failed database and its journal files together, and prevent those journals from being attached to the restored database.

Activate the validated recovery database only with all operational connections closed. Recovery does not imply that the newly installed app can operate on every older schema; establish a supported retry or compatible app version explicitly before enabling normal commands. A retry uses the preserved historical artifact identities and an explicitly validated migration plan.

This is an upgrade recovery path, not a destination-picker or general backup-management surface. [Architecture](../architecture.md#schema-migration-recovery-and-manuscript-delivery) owns its runtime placement.

## Consequences

Schema upgrades preserve a bounded recoverable database state at the cost of a database copy and object-retention pins. The checkpoint stays in the application data directory and is not a disaster-recovery promise for device loss. Test interrupted checkpoint/migration/publication, disk-full, concurrent startup/writes, a corrupt snapshot, foreign-key violations, incompatible schema, changed migration artifacts and restoration without unintended provider work. Cover failure before commit, failure after commit and an uncertain commit outcome; verify that restoration keeps the schema revision, Kysely history and artifact metadata consistent with the restored research data. The library bytes are protected against migration/cleanup effects, not copied into a general archive.

[^sqlite-backup]: SQLite's backup API produces a database snapshot; Ohtia defines exclusive migration access, validation and retention.
