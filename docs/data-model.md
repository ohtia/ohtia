---
type: Specification
title: "Data model"
description: "Source entities, research-project relationships, and versioned project titles, thesis profiles, stage decisions and Markdown manuscripts in SQLite."
sources:
  - id: biblatex
    resource: "https://www.ctan.org/tex-archive/macros/latex/contrib/biblatex/"
    title: "CTAN — BibLaTeX"
  - id: unicode-normalization
    resource: "https://www.unicode.org/reports/tr15/"
    title: "Unicode — Normalization Forms"
---

# Data model

## Scope and ownership

This is the foundational logical data model for one operating-system user's Ohtia data store. [Product definition](product-definition.md#research-model) owns the meaning of research entities; [Architecture](architecture.md#application-data-authority) owns storage/process boundaries; [Draft format](draft-format.md) owns manuscript syntax.

A **research project** is a thesis, paper or other investigation. It is neither the Ohtia application nor a separate database file. Library sources and retained bytes can be associated with several projects; using the same source does not copy another project's interpretation, review or manuscript into the active investigation.

The diagram and fields below establish ownership, identity and consistency requirements. They are not SQL migrations or the complete future product schema. Add the detailed tables for claims, arguments, research review, tasks and other capabilities when their behavior is specified, preserving these boundaries. Do not implement a placeholder table for every conceptual product entity merely because it appears in the vocabulary.

## Foundational ERD

```mermaid
---
config:
  layout: elk
  look: classic
---
erDiagram
    PROJECTS ||--o{ PROJECT_SOURCES : selects
    SOURCES ||--o{ PROJECT_SOURCES : reused_by
    SOURCES ||--o{ SOURCE_CONTENTS : has
    ASSETS o|--o{ SOURCES : original_for
    ASSETS o|--o{ SOURCE_CONTENTS : input_for
    PROJECTS ||--o{ DRAFTS : owns
    DRAFTS ||--|{ DRAFT_REVISIONS : preserves
    DRAFT_REVISIONS ||--o| DRAFTS : current_for

    PROJECTS {
        uuid id PK
        text title
        text project_type
        text document_language
    }
    PROJECT_SOURCES {
        uuid id PK
        uuid project_id FK
        uuid source_id FK
    }
    SOURCES {
        uuid id PK
        uuid asset_id FK
        text bibliography_biblatex
        integer revision
    }
    SOURCE_CONTENTS {
        uuid id PK
        uuid source_id FK
        uuid input_asset_id FK
        text text_content
        text locator
    }
    ASSETS {
        uuid id PK
        text content_hash UK
        integer byte_length
        text media_type
    }
    DRAFTS {
        uuid id PK
        uuid project_id FK
        uuid current_revision_id FK
        text title
    }
    DRAFT_REVISIONS {
        uuid id PK
        uuid draft_id FK
        uuid parent_revision_id FK
        text markdown
        text language
        text created_at
        text save_reason
    }
```

Each committed draft has at least one revision and exactly one current revision belonging to that draft. The two draft/revision relationships are intentional: historical membership and the current pointer have different meanings. The `uuid` notation denotes an internal UUIDv7 identity stored as a 16-byte SQLite `BLOB`, not a native SQLite UUID type. [ADR-0008](adr/adr-0008-uuidv7-entity-identifiers.md) defines generation, encoding and validation; foreign keys use the same encoding as their referenced keys. External identifiers, citekeys, content hashes and manuscript block identifiers retain their separate contracts. An optional original asset permits sources without a retained file; it does not imply bytes were downloaded. Content input references preserve which retained file an extraction used.

## Source library

### `sources`

Each source has one library record containing its identity, bibliography and descriptive information.

- `id`: stable identity of a library source, independent of title, DOI, citekey and file path.
- `asset_id`: optional direct reference to the retained original file in `assets`. For an imported PDF source, this is the PDF opened from the source record. Sources without a retained original leave it empty.
- `bibliography_biblatex TEXT`: the complete bibliographic entry using BibLaTeX entry types and fields. The entry text is the stored bibliography; a parsed object or search index is derived rather than another independently editable bibliography.
- `revision`: a counter checked when updating the source record, so a stale edit cannot overwrite a newer one. It does not introduce a separate source-version entity or preserve past metadata by itself.
- Kind, publication condition, relevant origin/acquisition statements and use restrictions describe the source with their actual scope and provenance.
- Creation/update times and producer attribution record observed facts rather than inferred verification.
- Publication/external identifiers support discovery and duplicate assessment; they do not authorize an automatic merge of different editions or materials.

The source is reusable across research projects. Correcting its library description updates the same source record. The source opens its original through `asset_id` and lists extracted/corrected text through `source_contents.source_id`. Retained contents and their derivation remain independently identifiable; correcting bibliography does not overwrite a PDF or an extraction. Manuscript revisions and deliveries retain the bibliography entries they actually used, so a later source edit cannot silently rewrite an earlier citation or delivery.

BibLaTeX uses `.bib` bibliographic data with its supported fields and entry types.[^biblatex] Store the entry itself without Markdown code fences. Serialize field lines with two spaces of indentation and exactly one space on each side of `=`; do not use tabs or padding to align columns.

Generate citekeys using `nameyearkeyword`: the author's family name, publication year and a meaningful title keyword, combined in lowercase ASCII without spaces or diacritics. For example, García, 2025 and Aprendizaje produce `garcia2025aprendizaje`. Check for collisions in the bibliography mapping rather than silently binding the same key to a different source. Assigned or imported keys are not silently regenerated when bibliographic metadata changes.

Store bibliography text as UTF-8. Keep names, titles and other literal text in Unicode normalized to NFC, preserving their original spelling and accents.[^unicode-normalization] Do not convert accented letters to TeX escape sequences merely for encoding consistency. Treat syntax-sensitive characters according to the field's BibLaTeX rules; Unicode normalization does not replace syntax-aware parsing or escaping, and must not rewrite identifiers, verbatim values or protected TeX expressions.

A synthetic example is:

```bibtex
@article{garcia2025aprendizaje,
  author = {García, Ana},
  title = {Aprendizaje y escritura académica},
  journaltitle = {Revista de Investigación},
  date = {2025},
  volume = {12},
  pages = {15--30}
}
```

The citekey belongs to bibliography resolution, not to the source's UUID identity. Preserve imported supported fields and any required string definitions or inherited entries under the bibliography import contract. Report unsupported or unresolved dependencies instead of silently discarding them. Author/title/year lookup can use derived fields; editing them must update this source entry rather than create a second editable record. The parser and import/export fidelity checks are selected with that implementation.

A source update checks and advances its record revision in the same transaction. Dispatch always checks restrictions currently in force; a historical bibliography snapshot or earlier permission does not authorize a new transfer after restrictions changed. Input content used as evidence remains reconstructable independently of the current bibliographic description.

### `assets`

- `id`: opaque retained-file identity.
- `content_hash`: SHA-256 of the unmodified file bytes, stored as 64 lowercase hexadecimal characters and unique within the managed object collection. The exact file key is derived by [ADR-0009](adr/adr-0009-managed-imported-files.md).
- `byte_length` and `media_type` describe retained content. Derive the managed object key from `content_hash`; do not store a second editable path or accept arbitrary caller-supplied paths.
- The original display filename is metadata; the managed object key uses fixed ASCII components and the content hash. [ADR-0009](adr/adr-0009-managed-imported-files.md) defines why retained files are copied into Ohtia-managed storage rather than depending on their original paths.

Identical bytes can be stored once and referenced more than once. Byte deduplication does not merge source records, provenance, rights or academic review. PDF originals, images and other attachments live in the object directory; the database stores their relationships and exact identities. A URL alone is not an asset with retained bytes.

### `source_contents`

For an imported PDF, `sources.asset_id` gives direct access to the retained original. Text extracted from that PDF is stored in `source_contents`, linked back through `source_id`. Opening the source can therefore show both its original PDF and the extracted/corrected text. The PDF does not need another content row just to be accessible.

- `id` and `source_id` identify one content item or text version belonging to the source.
- `text_content TEXT` retains extracted or corrected text in SQLite when text has been obtained. Recording only an external locator does not establish that content is available.
- Optional `input_asset_id` identifies the exact retained original file used for extraction. It preserves provenance even if a source's selected original later changes.
- Derivation/predecessor identifies an earlier content record when correcting or transforming its text; it is distinct from the original input file.
- Kind, language, processing coverage, locator and content identity preserve what the processing or examination actually used. Explicitly distinguish externally referenced content from retained text.

For example, import a scanned PDF and attach its asset to the source, then create a content row with the OCR text and that PDF's `input_asset_id`. Correcting OCR creates another content version linked to its predecessor; it does not overwrite text used by an earlier analysis. The PDF bytes remain stored once.

Assets describe files and their managed locations. Source contents retain the text Ohtia can read or analyze and its origin. Images attached to a manuscript can be assets without being source contents; extracted text does not require a separate text file.

An original PDF, extraction, corrected extraction and later edition are not interchangeable. Evidence identifies the source and exact file/content examined plus the actual locator/quote. A proposed mapping to new content is separately reviewable; anchors do not migrate silently. Recording a physical object's catalogue information does not imply a digital original or extracted text exists.

## Research projects and source selection

### `projects`

- `id`: stable research-project identity.
- `title`, document language and observed creation/update metadata describe the investigation; the document language is the BCP 47 language of the document's text, confirmed by the researcher during setup and never changed afterwards, in which agents work and answer.
- `title_revision` is a positive safe integer. Existing and new projects start at 1. For an active, setup-confirmed thesis, the rename command compares the supplied expected revision against the stored revision in the write transaction. A stale revision rejects the save. A changed title advances the revision by exactly one. An unchanged title records the confirmed result at the same revision. Opening a thesis and confirming its initial setup leave the title revision intact.
- `project_type` classifies the research undertaking using a code-owned typed catalog. SQLite enforces the released catalog with a `CHECK` constraint; the application validates the same values. It is not a user-editable lookup table. Localized display names live in interface message catalogs, while stored values are stable English identifiers. Catalog changes require coordinated application/schema changes, and the feature contract defines the exact values before implementation.
- The research profile, plan and workflow state belong to this project under their respective feature contracts.

Each accepted rename stores its previous and resulting title and revision in immutable history alongside the command receipt, in the same transaction. Reconciliation of the same operation and payload returns that exact recorded result. The project identity, opening order, confirmed language, setup proposal history and manuscript labels are preserved ([PRIN-004 and PRIN-013](product-definition.md#product-principles)).

The diagram defines manuscript ownership and cardinality. A project title is not a storage path. Interface locale remains separate from the project's document language, which is also the manuscript's language.

### `project_sources`

- `id`, `project_id` and `source_id` identify one source's explicit inclusion in a project's working library.
- The project/source pair is unique. The association points directly to the source record and does not duplicate its bibliography.
- Project work identifies the exact `source_contents` records it examined. Historical manuscript bibliography snapshots remain separate from the source's current description.
- Project selection, reading priorities and any narrower processing restrictions stay with the association rather than altering every other project's use.

Library existence and project incorporation are different acts. A user can add an existing source to another project without downloading its files again. That does not transfer notes, arguments, scoped reviews or prior human confirmations. Any reusable analysis must satisfy its exact input/configuration and current-restriction contract and keep its original provenance.

A command or agent attempt can access only the project's authorized source associations and deliberately selected library material. Access to application storage does not grant blanket permission to transmit library content to a connected provider. Removing an association leaves other projects and the library source intact.

## Thesis profile

A setup-confirmed thesis has at most one row in `thesis_profile_heads`. Before the first save, the profile is unset. The project owns the setup-confirmed working title and immutable document language. The profile's reported target-language needs and the interface locale are independent. Recording research context leaves the manuscript and project setup history intact ([PRIN-002, PRIN-004–007 and PRIN-013](product-definition.md#product-principles)).

Each immutable `thesis_profile_revisions` row has a UUIDv7, owning project, positive sequence number, immediate predecessor, complete encoded snapshot, changed field keys and a durable command receipt. SQLite requires the head and predecessor to point to revisions of the same project. A save checks the expected revision, using zero for an unset profile, and replaces only the submitted fields. Omitted fields retain their prior values. The stored change set lists fields whose encoded values actually changed, including attribution, in lexical order. An accepted save with identical values appends a revision with an empty change set. History, the new head and the receipt commit in one transaction. Reusing the operation identity and equivalent canonical payload reconciles to the original receipt and its revision.

### Profile schema version 1

The canonical UTF-8 JSON body contains `schemaVersion` and a sparse `fields` object with these keys.

- Attributed text fields are `thesis_level`, `modality`, `institution`, `program`, `discipline`, `approach`, `working_point`, `topic`, `estimated_length`, `citation_practice`, `experience` and `autonomy`.
- Lists of attributed text are `interests`, `goals`, `target_languages`, `questions`, `objectives`, `institutional_requirements`, `integrity_conditions`, `ai_use_conditions`, `restrictions`, `academic_support`, `tools`, `difficulties`, `adaptations`, `bibliography`, `corpus`, `data`, `methods`, `passages` and `decisions`.
- `deadline` takes an attributed Gregorian calendar date in `YYYY-MM-DD` form. `milestones` is a list of attributed values with a title and an optional date in the same form. `weekly_availability_minutes` takes an attributed integer between 0 and 10,080 inclusive.

Every field may be explicitly `unknown` or `inapplicable`. A missing key represents an unrecorded field. A `known` scalar carries a `value` and an `origin`. A `known` list carries `items`, each with its own known value and origin. Known zero availability and a known empty list are explicit values.

Supported origins are a researcher statement, a description of supporting material, an exact same-project conversation message revision, and explicit adoption of a stored proposal. A description preserves what the researcher reported about the material. The utility resolves message links to saved researcher messages or complete agent replies and checks project ownership. A stored proposal has its own UUIDv7, project, completed producing attempt, base profile revision, field and proposed value. Adoption matches that project, attempt, field, value and base. A later edit to a list can preserve already adopted items with their original provenance. Adopting a value records a researcher action and the agent's contribution. It grants no institutional approval or broader evidence coverage.

Each text fact, milestone title and material description is limited to 2 KiB UTF-8. Each list is limited to 16 items. The complete canonical revision body, including its provenance and schema version, is limited to 32 KiB UTF-8. A rejected request leaves confirmed history intact. The receipt contains the exact revision identity, predecessor, sequence and changed fields. See [the bounded application port](application-port.md#research-operations-and-text-parts) for the scoped reads, save and receipt.

## Research stages and decisions

A setup-confirmed thesis has a separate decision sequence for each stage. The registry uses the identifiers `onboarding`, `topic_problem`, `literature`, `methodology`, `investigate`, `describe` and `interpret`. An empty sequence reads as `not-started` at revision zero. The latest entry or reopening reads as `in-progress`, and the latest recorded milestone completion reads as `done`. The scoped snapshot reports whether entry and reopening are available, gives the current profile revision if present, and identifies the most recent project-wide entry or reopening. Onboarding supports entry and reopening. The later stages report that their workflows are unavailable.

Each append-only decision stores its UUIDv7, project, stage, committed stage revision, predecessor, project-wide order, operation identifier, preceding state, transition, researcher as the observed local actor, application-observed timestamp, reason, profile revision, supporting artifact versions and remaining conditions. The read projection includes the preceding revision number as the expected revision. The profile reference may be empty before the first profile is saved. An artifact reference resolves to a saved researcher conversation message or a complete agent reply within the same project at its immutable message revision. The port admits up to 16 distinct artifact links, up to eight conditions of 256 UTF-8 bytes each, a nonblank reason of up to 1,024 UTF-8 bytes and, for reopening, a nonblank next-review condition of up to 512 UTF-8 bytes.

The first entry expects an empty stage sequence. Reopening expects the exact current stage revision and a reference to its recorded completion. Both compare the selected profile revision with the current profile inside the transaction. A reopening points to the prior completion and exposes that decision’s profile revision and artifact versions as affected outputs alongside the next-review condition. The earlier decision retains its exact evidence and coverage. Reopening records a new human decision and preserves the underlying artifacts and profile revisions. The [version-bound research review decision](adr/adr-0035-version-bound-research-review.md) governs how confirmation applies to those versions.

SQLite enforces the project/stage predecessor, per-project and per-stage order, profile and artifact ownership, immutable history and matching receipt. The utility commits the decision, artifact links and receipt together. The operation identity binds the original payload without the window subscription. A replay returns the original decision, and a changed payload conflicts. The scoped port exposes the snapshot through `stage.read` and one exact revision through `stage.history`. The explicit `stage.transition` command and `stage.receipt` use the same intent. A `researchStage` subscription event carries the project-wide decision sequence after a commit.

## Manuscripts and revisions

### `drafts`

- `id`: stable manuscript identity.
- `project_id`: the research project owning this manuscript.
- `title`: a user-facing label, independent of an export filename.
- `current_revision_id`: the authoritative pointer to one committed revision of this same manuscript.

Do not add another authoritative `markdown` column here merely to duplicate the current revision's text. Read current content through the referenced revision. An implementation can add rebuildable projections for performance, but they do not become independent editable copies.

### `draft_revisions`

- `id` and `draft_id`: immutable revision and manuscript identities.
- `parent_revision_id`: the immediately preceding current revision; absent only for the initial revision, and never pointing to another manuscript.
- `markdown TEXT`: the complete canonical manuscript text in [the academic profile](draft-format.md), including its format metadata and stable block identities.
- `language`: the manuscript writing-language tag retained with this immutable revision, using the most precise known BCP 47 tag; null explicitly means unknown. Read the current manuscript language through its current revision, without adding another mutable authoritative copy to `drafts`.
- `created_at`: the observed save instant in UTC.
- `save_reason`: an explicit action category such as initial creation, grouped autosave, manual save or restoration.
- Action/producer attribution and content hash distinguish who wrote the content from which process recorded the save.
- An optional restoration-origin revision identifies the old version being restored; it is distinct from the current predecessor in the revision chain.

The initial manuscript language comes from the researcher's explicit choice or supported imported metadata, which starts as the project's document language. Changing the interface locale never relabels previous or current manuscript text. Restoration retains the restored revision's language alongside its text. Unknown language remains explicit in rendering and export rather than receiving a fabricated tag. This document-level value does not solve mixed-language passages: the draft profile's attribute restriction remains an accessibility blocker documented in the [design system](design-system.md#conformance-blockers).

The researcher edits only through Ohtia. A generated `draft.md` is an output, not a file watched for external changes. Editor JSON and ASTs are working representations; they are not the only stored manuscript. The first implementation preserves complete revision text rather than relying exclusively on patch-chain reconstruction. Diffs for comparison can be computed later.

Creating a revision and advancing `drafts.current_revision_id` occur in one transaction after checking the expected predecessor. A stale save yields conflict instead of overwriting a newer revision. Initial creation installs the manuscript and its first revision in the same command; an externally observable committed manuscript cannot have a dangling current pointer. Repeated delivery of the same idempotent command cannot create duplicate revisions.

Restoration creates a new revision based on the old text while retaining the current predecessor and recording restoration origin. It does not delete intermediate history or move earlier comments/reviews to the restored text. Group autosaves rather than creating a full revision per keystroke. No pruning policy is selected here: any future compaction must preserve revision-chain integrity and content needed by deliveries, comments, reviews and historical evidence.

Observation and research-review storage is defined with its feature's commands and lifecycle, rather than introducing a generic comment table here. Its targets must retain the exact manuscript revisions, source content identities and input evidence examined. A comment or stable block ID cannot stand in for a human confirmation or make an old observation current after an edit.

## Referential and lifecycle invariants

Enforce foreign-key relationships, ownership checks and relevant uniqueness constraints in the database and trusted data service. The current manuscript pointer must target a revision of that same manuscript; source contents must belong to the source referenced by the operation. Expected-version checks, idempotent command receipts and related history belong to the same domain transaction. [ADR-0007](adr/adr-0007-sqlite-repositories-and-migrations.md) defines the Kysely repository and migration boundary, including the separate technical metadata for migration artifact identities. The physical migration must demonstrate these invariants, including initial creation and rollback, rather than relying on a diagram alone.

Stable IDs survive renaming, movement and supported migration. Content/representation versions remain immutable where used as evidence; correction creates a new version and identifies dependencies needing review. No agent-generated field can replace the project's trusted identity or issue a human confirmation.

Deleting a research project affects its owned work and associations under explicit retention rules; it does not cascade through library sources or files used elsewhere. Removing library material requires checking references across all projects and historical evidence. A pre-migration checkpoint records and protects the retained object identities referenced by its database snapshot; it does not create a general library backup. [ADR-0010](adr/adr-0010-pre-migration-recovery.md#retention-erasure-and-disclosure) requires purging managed recovery/failed-state copies before accepting destructive erasure. Mere association removal or soft deletion does not establish erasure of the requested content, history or originals.

Credentials, provider-owned authentication files, transient host paths and disposable execution contexts do not enter these research records or pre-migration checkpoints. [ADR-0051](adr/adr-0051-research-agent-task-execution.md) defines logical task/attempt identities, states, transition receipts and admission/recovery invariants. Physical task/provider tables are specified with their implementation, preserving that contract, project scoping and current restrictions. [Agent collaboration](agents/agent-collaboration.md#intervention-and-contribution-records) owns logical intervention, contribution, memory and editorial-proposal records; their physical schema must retain project ownership, immutable input/artifact links and separate human approval receipts. The complete knowledge-interchange serialization is a later contract; identifiers, version links, relationships and provenance are preserved now so it can be built without reconstructing missing research history.

[^biblatex]: BibLaTeX defines the bibliography types/fields and processes `.bib` bibliographic data. Ohtia retains those entries instead of defining a competing bibliography vocabulary; this does not select a LaTeX compiler or parser implementation.

[^unicode-normalization]: Unicode defines NFC as canonical normalization; Ohtia applies it to literal bibliographic text while preserving field syntax and identifiers.
