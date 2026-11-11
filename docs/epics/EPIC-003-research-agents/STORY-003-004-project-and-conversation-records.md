---
type: Story
title: "STORY-003-004 — Project and conversation records"
description: "Store projects, conversations, messages and idempotent command receipts with their data-service operations."
generated:
  by: claude-code/claude-opus-5-5
verified:
  by: human:AdrianMastronardi
tags: [story, "comp:storage", "comp:docs"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/206
epic: "EPIC-003"
epic_concept: ./epic.md
components: ["comp:storage", "comp:docs"]
applicable_blocks: ["SPEC-003-009"]
---

# STORY-003-004 — Project and conversation records

## Description

Add the `projects`, `conversations`, `messages` and `command_receipts` tables, the five data-changing operations and three reads, migration `0007` with the ADR-0010 checkpoint, and the bundled IANA Language Subtag Registry. No window uses them yet.

## Applicable specification

- [SPEC-003-009: Project and conversation records](./epic.md#spec-003-009-project-and-conversation-records)

## Tasks

- [ ] Start from `packages/utility/src/migrations/` with `manifest.json` and `packages/utility/src/storage.ts`, and extend these existing boundaries rather than create parallel ones.
- [ ] Write migration `0007` with the four tables and their database rules, including the all-or-none rule for title, document language and confirmation time, the immutable `projects.is_development` (0 for every project this story creates), the canonical-case check on `document_language`, message positions that are positive, unique and increasing within a conversation, not necessarily consecutive, and `conversations.revision`, which starts at 1 and advances by one in every transaction that renames the conversation or saves a message in it.
- [ ] Add `config/localization/iana-language-subtag-registry.txt`, IANA's Language Subtag Registry copied byte for byte when the story is implemented, and record its `File-Date` and SHA-256 in the pull request.
- [ ] Check that the copy ends with exactly one line feed and has no trailing whitespace; if not, give `end-of-file-fixer` or `trailing-whitespace`, whichever would change it, an `exclude` of that path with the comment "# IANA's Language Subtag Registry, copied byte for byte; its File-Date line identifies the copy.", indented eight spaces. The copy measured on 2026-11-10 (731,819 bytes) fits the 1024 KB limit of `check-added-large-files`, so that hook needs no exclusion.
- [ ] Accept `document_language` only as `language[-script][-region]` (a 2- or 3-letter language, an optional 4-letter script, an optional 2-letter or 3-digit region, nothing else), convert it to canonical case before every check, and require each subtag to exist in the bundled registry with the matching `Type` and no `Deprecated` field, in every operation that receives a tag.
- [ ] Implement the five data-changing operations `project.create`, `project.confirmSetup`, `conversation.start`, `conversation.rename` and `message.append` with `command_receipts` idempotency, accepting only these names in `command_receipts.command`, and the three reads `project.list`, `conversation.list` and `message.list`; `conversation.start` creates a conversation of a confirmed project with its first researcher message in one transaction, and `message.append` appends a researcher message after the highest position used or reserved in the conversation; `conversation.list` orders conversations by their latest message, the one at the highest position.
- [ ] Reject without saving anything, with these error codes: `project.confirmSetup` of a confirmed project with `project_not_in_setup`; `conversation.start` in a project in setup with `project_in_setup`; a name outside the title rules with `name_invalid`; an empty researcher message in `conversation.start` or `message.append` with `message_invalid`; and an identifier that names no record the command needs with `record_not_found`. Add these codes to the port's closed `errorActions` in `packages/contracts/src/port.ts` with their next actions: the new `refresh_record`, which tells the window to read the named records again and show their current state without repeating the command, for `project_not_in_setup`, `project_in_setup` and `record_not_found`, and `check_request` for `name_invalid` and `message_invalid`. A rename conflict uses the existing `stale_revision`.
- [ ] Accept an operation identifier from the window, from main or from the development command.
- [ ] Hash each payload, the port request's `payload` object, as the SHA-256 of its RFC 8785 canonical JSON, and store receipts only for accepted commands.
- [ ] Rename a conversation only with its expected `updated_at`: a stale value is rejected with `stale_revision`, whose `currentRevision` is the conversation's current `revision`, and changes nothing; each rename writes an `updated_at` later than the previous one; a message saved meanwhile advances `revision` but not `updated_at`, so it makes no conflict.
- [ ] Generate identifiers with `crypto.randomUUIDv7()`.
- [ ] Apply the documentation amendments of SPEC-003-009 to `docs/data-model.md` (the diagram, the project fields, the language separation and the two manuscript-language sentences), `docs/product-definition.md`, `docs/thesis-workflow.md`, every remaining "analysis language" of `docs/frontend-architecture.md`, `docs/design-system.md`, `docs/agents/agent-collaboration.md`, `docs/agents/agent-virgilio.md`, `docs/agents/agent-thomas.md` and `docs/product-roadmap.md` except the two roadmap passages of the next task, `docs/localization.md` ("Help text distinguishes interface language from document and analysis language." becomes "Help text distinguishes interface language from the language of documents and analyses, which is the project's document language."), ADR-0024's two language sentences as an editorial correction, SPEC-002-019 of `docs/epics/EPIC-002-basic-interface/epic.md` ("source pixels, analysis language or export settings" becomes "source pixels, document language or export settings") and ADR-0008.
- [ ] In `docs/product-roadmap.md`, "Settings grows with the product", the row "Analysis language and research profile | Research project" becomes "Research profile | Research project", keeping its third cell, and above it add the row "Document language | Research project | EPIC-003", both aligned with the table's columns; in the onboarding entry that follows the EPIC-003 entry, "explicitly selected analysis language before assistance" becomes "the project's document language, confirmed at setup". In SPEC-002-010 of `docs/epics/EPIC-002-basic-interface/epic.md`, "no dead Connections, Diagnostics, Storage, analysis-language or concurrency controls are supplied now" becomes "no dead Connections, Diagnostics, Storage, document-language or concurrency controls are supplied now".

## Acceptance criteria

- [ ] Each database rule rejects invalid data and each operation works on a real SQLite database.
- [ ] Repeating an operation returns its first result; reusing an identifier with different content is rejected; two payloads that differ only in key order hash the same; a rejected command leaves no receipt.
- [ ] `en`, `ast`, `sr-Latn`, `es-419` and `pt-BR` are accepted, `ES-ar` is stored as `es-AR`, and `iw`, `en-US-x-test`, `zh-min-nan` and an unknown subtag are rejected.
- [ ] A rename with a stale `updated_at` is rejected with `stale_revision` and changes nothing, and a message saved between two renames advances the conversation's `revision` without a conflict.
- [ ] Confirming an already confirmed project fails with `project_not_in_setup`; starting a conversation in a project in setup fails with `project_in_setup`; an empty message fails with `message_invalid` and an unknown conversation with `record_not_found`; a start that fails leaves neither a conversation nor a message.
- [ ] A version-0006 database upgrades and keeps its preferences; a failing migration rolls back, keeps the source database and closes the data gate until the explicit retry or restore.
- [ ] The packaged application opens and upgrades an existing database.
- [ ] `pre-commit run --all-files` passes with the registry copy, whose bytes still match the SHA-256 recorded in the pull request.
- [ ] Apart from this EPIC's own concept files, which quote the replaced texts, no document under `docs/` still says "analysis language" or "analysis-language" in any capitalization, and the roadmap's Settings table has the row "Document language | Research project | EPIC-003".

## Quality checklist

- [ ] Automated tests pass in all 12 CI cells: Ubuntu 26.04 GNOME and KDE on x86-64 and ARM64, Fedora 44 GNOME and KDE on x86-64, Debian 13 GNOME and KDE on x86-64, Windows on x86-64 and ARM64, and macOS 26 and 27 on ARM64.
- [ ] The story's operations emit `ohtia-log-v1` catalog events with a privacy review, and no prompt, response, tool argument, title, memory text, credential or provider error message reaches diagnostics.
- [ ] Migration `0007` runs through the existing ADR-0010 checkpoint and recovery path; if a story that runs at the same time merges its migration first, this story renumbers its own to the next free number and updates `manifest.json` and the storage revision list before it merges.
- [ ] Every document under `docs/` that this story amends gets this story's `generated.by` and loses its `verified` declaration, which the researcher adds again after reviewing it, as `AGENTS.md` requires.
- [ ] The change passes `pre-commit run --all-files`, the two-reviewer code review gate in `AGENTS.md` and the required `ci` check.
