---
type: DecisionRecord
title: "ADR-0036 — Typed SQLite preferences with a separate bootstrap locator"
description: "Keep application preferences with transactional services and resolve the data directory through a fixed native configuration locator."
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
---

# ADR-0036 — Typed SQLite preferences with a separate bootstrap locator

## Context

Layout, appearance, language and execution limits are application preferences shared across research projects. Limits must coordinate with persisted task admission, while the selected data directory must be known before its database opens. One setting cannot bootstrap the database from inside that same unopened database.

Alternatives are browser storage, separate files for every feature, a single external JSON settings file, or SQLite preferences with a minimal external locator. Browser storage contradicts the privileged desktop boundary. Per-feature files duplicate validation and publication logic. Keeping all settings in JSON would require cross-file/database coordination for task limits. The split keeps ordinary settings under the existing transactional owner while making only storage discovery a bootstrap exception.

## Decision

Use the application data service for typed, versioned application preference records in SQLite. Keep the research-data-directory locator outside that data store, owned by the main broker at the fixed native application configuration location. [System architecture](../architecture.md#application-preferences-and-bootstrap) owns the exact paths, record ownership, validation, atomic publication, failure handling and verification contract; [Workspace layout](../workspace-layout.md#desktop-preference-boundary) owns its feature record and cross-window semantics.

Do not treat preferences as research entities, credentials or arbitrary caller-defined JSON. Keep the existing domain/storage/IPC authority boundaries. Storage-location changes require their explicit lifecycle rather than a generic preference update.

## Consequences

Normal preference changes share database transactions and recovery with the application services. The bootstrap locator needs a small, independently verified file-publication path on every supported OS. Preference availability follows the selected data store, so recovery uses explicit presentation fallbacks while preserving saved-data uncertainty. Test both persistence boundaries and interruption; selecting this design does not establish a working implementation or general backup management.
