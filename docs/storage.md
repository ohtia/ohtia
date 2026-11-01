---
type: Playbook
title: Durable foundation storage
description: Open the isolated local store, persist appearance choices and verify exclusive migrations and whole-database recovery through the packaged desktop.
---

# Durable foundation storage

## Authority and opening

The [persistent storage specification](epics/EPIC-001-desktop-foundation/STORY-001-005-persist-a-minimal-command-with-verified-migration-recovery.md) consumes the [bounded application port](application-port.md) and [isolated desktop runtime](desktop-runtime.md). The utility alone opens the operational database through the binding selected by [ADR-0007](adr/adr-0007-sqlite-repositories-and-migrations.md). Main owns the native profile, graphical admission and locator publication. PRIN-004, PRIN-006, PRIN-007, PRIN-013 and PRIN-016 require distinguishing confirmed commits, transport uncertainty, retained copies and the scope of native observations.

The runtime starts with a supervised status service. The authenticated ready handshake precedes storage admission; migration, backup and restore work do not consume the service-start deadline. An explicit opening state keeps storage commands gated and prevents overlapping retries while admission runs. The broker returns controlled unavailability instead of forwarding short-deadline commands to a utility occupied by admission. The initial window explains the sensitivity of recovery copies before **Open local data** starts storage admission at the [fixed native-home root](architecture.md#application-preferences-and-bootstrap). There is no directory selector. An invalid locator or unqualified profile blocks store access rather than selecting another location. Main creates a database only when no locator or retained recovery store exists; a missing database behind an initialized locator blocks admission. Main publishes a missing locator only after the utility validates the store, and enables the shared appearance port only after confirmed publication. Uncertain publication preserves the data and requires an explicit retry.

The assembled application carries the exact target addon in `native/binding.node`, its trusted identity and runtime expectations in `storage.json`, and the matching driver wrapper. The utility checks its native target/runtime, addon SHA-256, effective SQLite version/source ID, required compile options and foreign-key enforcement. Engine failures do not select another driver or system library. The checkpoint manifest records the actual connection's complete compile-option list.

## Preferences and receipts

`application_preferences` contains declared keys, schema versions, safe integer revisions and text values. Fresh initialization inserts both execution limits with value 1 in the schema transaction. Compatible opening preserves valid saved policy; a missing initialized policy, unsupported version or invalid positive-integer value blocks admission. A presentation fallback does not repair its stored bytes. A saved supported interface-locale identifier is decoded after store admission and resolved by the existing broker locale service; a rejected encoding produces a controlled notice and preserves the saved value.

The [interface language preference](localization.md#named-preference-operations) uses the same record owner, transactional guarantees and migration/checkpoint path, with its own named operations and durable receipt table. Its value is `system` or a supported explicit locale.

Appearance uses the existing named port operations and `system`, `light` or `dark` values. Reading an absent record returns the declared system default at revision zero. A replacement checks its expected revision and commits the record and immutable command receipt together. A matching operation replay returns its original outcome; another payload cannot reuse that identity. Stale outcomes are also recorded. Failed transactions preserve the last confirmed value. A missing acknowledgement requires receipt inspection before another explicit save; it is not permission to allocate a new operation and repeat the effect.

All windows use the same broker and writer. The graphical control keeps unsaved input during failures and service replacement. Reconnection obtains a new trusted service/window generation without reloading the document, disposes old calls/subscriptions and rejects stale replies. A confirmed preference applies across windows; refreshing after a stale revision preserves the user's draft for the next explicit save.

Preference keys and operation identifiers keep their separate contracts. This schema introduces no research entity. The native harness has an isolated UUIDv7 representation/reference fixture under the packaged binding; that fixture is not a production entity schema or a selected production UUID generator. [ADR-0008](adr/adr-0008-uuidv7-entity-identifiers.md) governs any entity implementation that adopts such identities.

## Migration and recovery

The [storage owner](../packages/utility/src/storage.ts) selects a fixed ordered registry and explicit target. [Executable modules and their SHA-256 manifest](../packages/utility/src/migrations/manifest.json) are copied unchanged to library and desktop outputs. They are checked JavaScript artifacts retained independently of compiler/bundler output. Formatting excludes those modules. Their schema SQL and transforms remain self-contained; changing applied executable bytes requires another migration.

Compatibility checks validate `user_version`, source shape and constraints, Kysely history, artifact identities, integrity, foreign keys and execution policy before creating a checkpoint. Revision zero has no schema/history. An already-current compatible store gets no additional checkpoint. The initial migration owns initialized policy, so its absence from a later source is an integrity error rather than an instruction to reset defaults.

A complete temporary intent is synchronized and atomically linked without replacing an existing intent; interrupted publication cannot expose partial JSON. A durable `migration-pending.json` closes normal admission before checkpoint work. The utility uses `backup()` to materialize the complete source in an operation's partial directory, verifies length/digest, integrity, foreign keys and source metadata, synchronizes files/directories and atomically publishes the checkpoint. Hashing uses bounded buffers. No managed objects are referenced by this schema, so its retained-object list is empty.

The reserved connection owns `BEGIN EXCLUSIVE`, Kysely's migrator with transactions disabled, application artifact metadata, target validation, `user_version` and the final commit. Migration results must identify exactly the expected successful upward operations. A returned success is not a commit receipt. Earlier failures roll back the complete schema/data/history transaction and validate its source; later or uncertain failures retain the gate and checkpoint until explicit inspection.

**Retry** closes the old service, inspects actual compatible source/target state and uses the supported path. A verified source keeps its previous intent until an atomic complete replacement publishes the next attempt; an interruption cannot turn a retained empty source into fresh initialization authority. **Recover checkpoint** verifies the selected whole snapshot, materializes and validates a separate database, and records `restore-pending.json` before moving any failed database or journal. Interrupted moves reuse the same destinations. Activation rejects ambiguous files and ensures failed journals cannot attach to the restored database. Restoration leaves admission closed and the failed copies retained. A separate explicit **Retry** validates and advances the compatible source before enabling normal commands; it never invokes a downgrade or resumes external work.

Resolved failed/journal and partial copies are removed only after a verified target establishes normal admission; cleanup failure retains controlled recovery rather than announcing completion. The latest verified pre-migration snapshot remains. These copies have the sensitivity of the database, are not device-loss backups, and provide no erasure guarantee. [ADR-0010](adr/adr-0010-pre-migration-recovery.md) owns retention and the requirements that must precede any destructive erasure.

## Security evidence boundaries

[Foundation security applicability](foundation-security.md#enforcing-controls-and-evidence-ownership) owns the versioned ASVS baseline and control identifiers. FND-STORAGE binds its storage requirements to `DurableStore` admission, transactions and recovery: `roundtrip-replay-current`, `reject-newer`, `changed-module`, `returned-error`, `foreign-key`, `lost-commit-ack`, `checkpoint-denied`, `corrupt-and-interrupted-restore` and the required process-interruption cases exercise positive and failure outcomes under the packaged binding. The page-limit case establishes native SQLITE_FULL handling; it does not establish filesystem ENOSPC or power-loss behavior.

FND-AUTHORITY binds the shared port's revision, receipt and generation controls to the graphical lost-response, subscription replay and service-replacement cases. FND-NATIVE binds trusted engine/addon checks to `binding-and-engine-mismatch`, profile revalidation to the stable-fixture checks, and sandbox/display/cessation obligations to independent native observations. Evidence records carry the reviewed source tree, prepared artifact digest, native identities, exact case results and their limits; a portable test or configuration flag cannot substitute for those observations. The inherited runtime and application-port controls retain their own boundary qualification.

## Native verification

Prepare the worktree's locked tools and production build through the [workspace procedure](developer-workspace.md), then assemble the actual target and run inside its independently inspected native account or VM:

```bash
python3 scripts/workspace.py run build
python3 scripts/workspace.py run desktop:prepare <target> <new-absolute-runtime-directory>
python3 scripts/workspace.py run storage:test <absolute-runtime-profile.json> <absolute-runtime-directory> <new-absolute-evidence-directory>
```

Use actual declared arguments in place of the angle-bracket placeholders. The runtime profile uses the existing native admission contract; the evidence directory must be a new child of its scratch root. Use only permitted synthetic/public fixtures. The harness changes appearance and deliberately restores synthetic managed-store checkpoints, so never point it at a profile containing research data. Keep each failed attempt and use a fresh evidence directory for a corrected run.

The [required case inventory](../config/desktop/storage-cases.json) defines complete component, graphical and interruption accounting. The [graphical harness](../tooling/storage-acceptance.mjs) checks actual IPC, saved/stale/uncertain outcomes, window/service replacement, keyboard/reflow, restart and recovery controls. The [utility cases](../tooling/storage-native-cases.mjs) load the packaged storage module and addon, exercise file-backed compatibility, native SQLITE_FULL induced by an engine page limit (not filesystem ENOSPC), actual permission failures, competing initializers in one process and independent SQLite connection locking, transactional rollback, corrupt snapshots and interrupted restoration, and terminate real processes at checkpoint/before-commit/after-commit boundaries. Injected return/acknowledgement failures are identified separately from real process termination and actual filesystem failures.

Retain the complete source/candidate identity, prepared artifact inventory, native host/CPU/OS/filesystem/session, runtime/addon/SQLite identities, every required case result and actual exit receipts. Independently observe the active native sandbox and display backend, stable fixture contents/metadata before and after, and cessation of the owned process identities. An aggregate with omitted cases, another CPU's result, developer-Node execution or emulation cannot qualify a native profile. The [target manifest](../config/desktop/targets.json) defines the required profiles; [native qualification](native-qualification.md) owns their facility procedures. Physical power-loss behavior, human linguistic review and manual assistive acceptance require their own evidence rather than being inferred from this harness.

## Changing builds during an interrupted migration

A pending migration intent and its checkpoint identify a specific source and target transition. A build that does not admit that target preserves the records and refuses to open the store. Do not edit the intent, checkpoint manifest, migration history or database version to make admission pass. Use the build that created the pending transition to complete its explicit Retry or Recover checkpoint procedure, then open the compatible initialized store with the newer build. Ordinary initialized revision-2 stores use the verified 2-to-3 migration path; a pending transition is not an initialized compatible store. Keep the preserved failed attempt and checkpoint until recovery has been verified.
