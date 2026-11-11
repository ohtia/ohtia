---
type: Story
title: "STORY-003-019 — Concurrency limits"
description: "Let the researcher set how many AI replies run at once, from 1 to 50, without cutting running work."
generated:
  by: claude-code/claude-opus-5-5
verified:
  by: human:AdrianMastronardi
tags: [story, "comp:app", "comp:storage", "comp:desktop", "comp:docs"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/221
epic: "EPIC-003"
epic_concept: ./epic.md
components: ["comp:app", "comp:storage", "comp:desktop", "comp:docs"]
applicable_blocks: ["SPEC-003-024"]
---

# STORY-003-019 — Concurrency limits

## Description

Add the "Simultaneous work" Settings section with the "AI replies at the same time" field bound to `max_concurrent_inference`, its range and help texts, the ADR-0011 rules for changing limits, and the port operations `limits.read`, `limits.replace` and `limits.receipt` with their own receipt table.

## Applicable specification

- [SPEC-003-024: Concurrency limits](./epic.md#spec-003-024-concurrency-limits)

## Tasks

- [ ] Start after STORY-003-005 is merged and its output is on the base branch: Stored execution limits and admission.
- [ ] Start after STORY-003-007 is merged and its output is on the base branch: Cessation rule and uncertain handling.
- [ ] Start after STORY-003-010 is merged and its output is on the base branch: Research subscription for limit changes.
- [ ] Start from `packages/renderer/src/settings-dialog.tsx`, the `execution_limits` preference, `packages/contracts/src/port.ts`, `packages/preload/src/foundation-port.ts` and `packages/utility/src/migrations/0002_receipts.mjs`, and extend these existing boundaries rather than create parallel ones.
- [ ] Add the "Simultaneous work" section with one whole-number field, "AI replies at the same time", from 1 to 50, applied on blur or Enter, with the design system's preference-saving states and the existing Settings texts, `{setting}` being "AI replies at the same time"; a value outside the range shows below the field, read with it, "Enter a whole number from {min} to {max}. The saved value, {value}, is kept.", with `{min}` 1, `{max}` 50 and `{value}` the saved value, each formatted as a number.
- [ ] Show the help texts, one line per connected service: "More replies at once can use more of your {service} plan at the same time." for a `subscription` connection or "More replies at once can spend your {service} key's credit faster." for an `api_key` connection; "{service} allows at most {connection_limit} replies at a time.", with plural forms, for each connection whose declared limit is below the field's value; and, only when the limit is lowered below the number of replies running, "{running} replies are running. New ones will wait until fewer than {value} are running.", with plural forms on each count, with the running count that `limits.read` and `limits.replace` return and the saved value, whose `=1` branch reads "{running} replies are running. New ones will wait until none are running."
- [ ] Add the port operations `limits.read` (empty input; the revision, `max_concurrent_inference` and the number of inference replies running), `limits.replace` (input exactly `value`, a whole number from 1 to 50; the last write wins, advances the revision by one and returns the saved record with the running count) and `limits.receipt` (input exactly `targetOperationId`; `not_found`, `pending` or `recorded`), where a repeated `limits.replace` and a recorded receipt return the recorded value and revision with the current running count, because the receipt stores no running count, and never change `max_concurrent_local_processing`.
- [ ] Write the migration for `execution_limits_receipts` (`operation_id`, `value`, `result_revision`), written in the same transaction as each accepted change, like `appearance_receipts`; a rejected value leaves no row.
- [ ] Serialize saving and admission so no task starts under a superseded limit; lowering cuts nothing and raising does not resume paused or uncertain tasks.
- [ ] Propagate the change to every window, including a window with no open project, which holds `research.subscribe` for the records shared by every project, through a `research.subscribe` notice, after which each window reads the record again and ignores a revision it already has; a window that shows the field also reads it again after a `sequence_gap`.
- [ ] Apply the documentation amendments of SPEC-003-024 to `docs/frontend-architecture.md` ("Application Settings provides separate concurrency limits for inference, defaulting to 10, and for local processing, defaulting to 1." becomes "Application Settings provides the inference concurrency control, from 1 to 50 with a default of 10; local processing has no control until a feature uses it.") to the `docs/product-roadmap.md` Settings inventory (the row "Inference and local-processing concurrency" becomes "Inference concurrency") and to `docs/application-port.md` (after the `bounds.*` bullet of "Envelopes and named operations", the `limits.read`, `limits.replace` and `limits.receipt` bullet of SPEC-003-024) and to `docs/settings.md`, "Ownership" (after "Settings groups Language, Appearance and Workspace layout in one Accessibility and appearance section." add "Simultaneous work holds the AI replies at the same time control."); the range in ADR-0011 is already replaced by the ADR written in STORY-003-005.

## Acceptance criteria

- [ ] 0, 51, decimals and text are not saved, leave no receipt and show the range notice.
- [ ] Two saves from two windows keep the later one; a repeated `limits.replace` returns its recorded value and revision with the current running count, and `limits.receipt` reports the same.
- [ ] The running-replies line appears only while the saved limit is below the number of replies running, and `docs/settings.md` names the "Simultaneous work" section.
- [ ] The help text names each connected service in its kind's variant.
- [ ] Lowering the limit keeps running tasks running; raising it starts waiting tasks.
- [ ] STORY-003-008 is merged and its output is on the base branch: Plan and restart pauses for the tests. Then raising the limit does not resume tasks paused by a plan limit or a restart, and does not touch uncertain ones.
- [ ] Saving during admission uses the new limit.
- [ ] Scenario 10 of `agent-collaboration-evaluation.md`, as STORY-003-007 amends it, passes: changing the limit during competing admissions respects the application limit and the connection's limit, and an uncertain attempt holds no slot once its connection closes.
- [ ] Two windows both see the change, including a window with no open project that shows Settings.
- [ ] With the researcher's account and the limit at 1, a second conversation waits for the first.

## Quality checklist

- [ ] Automated tests pass in all 12 CI cells: Ubuntu 26.04 GNOME and KDE on x86-64 and ARM64, Fedora 44 GNOME and KDE on x86-64, Debian 13 GNOME and KDE on x86-64, Windows on x86-64 and ARM64, and macOS 26 and 27 on ARM64.
- [ ] Real-account checks run on the x86-64 virtual machines (Windows, Ubuntu 26.04, Fedora 44 and Debian 13) with the researcher's stored session. Each reply's duration and longest silence between provider events are recorded; a reply that uses more than half of its attempt duration, or a silence longer than half of `max_inactivity_ms`, raises that limit: in this story's own block before it merges when this story introduces that version; otherwise, recorded in this story's pull request, in that operation's next planned version that has not merged, whose story applies it before it closes; or, when none is planned, in a new policy-only version that this story adds before it closes. Each operation version this story introduces also takes, before the story closes, every raise that earlier stories recorded for it.
- [ ] The section meets WCAG 2.2 AA and ADR-0023's eleven selected AAA criteria, with ATAG 2.0 Part B as guidance, and is checked with the keyboard alone (focus order and restoration), a screen reader (names, roles, states and announcements), reflow at 320 CSS px, light and dark themes, forced colors, reduced motion, German, Korean with mixed scripts in the packaged fonts, pseudolocalization, the locale fallback and override, and the native input methods in its number field; each manual screen-reader result names the artifact, platform and journey, and its new text is in every supported locale catalog.
- [ ] Catalog text uses the typographic apostrophe ’ (U+2019) and quotation marks “ ”, as `en-US.json` does; this EPIC writes them as straight characters for readability.
- [ ] Its texts with plural forms are ICU plural messages, each count with its own plural selector; if the typed plural rendering contract that `docs/localization.md` requires of plural message producers is not on the base branch yet, this story adds it before its first plural message, and otherwise reuses it.
- [ ] The story's operations emit `ohtia-log-v1` catalog events with a privacy review, and no prompt, response, tool argument, title, memory text, credential or provider error message reaches diagnostics.
- [ ] The pull request records, under ADR-0000, the applicable OWASP ASVS 5.0.0 L2 requirement IDs for the new port operations `limits.read`, `limits.replace` and `limits.receipt`, with their applicability and evidence.
- [ ] Every notice this story adds holds only its icon and text inside its box; its buttons and links sit `space.2` below the box on the surrounding panel or page surface, never inside it, as `research-presentation.md` requires.
- [ ] Its migration runs through the existing ADR-0010 checkpoint and recovery path; if a story that runs at the same time merges its migration first, as STORY-003-016 can, this story renumbers its own to the next free number and updates `manifest.json` and the storage revision list before it merges.
- [ ] Every document under `docs/` that this story amends gets this story's `generated.by` and loses its `verified` declaration, which the researcher adds again after reviewing it, as `AGENTS.md` requires.
- [ ] The change passes `pre-commit run --all-files`, the two-reviewer code review gate in `AGENTS.md` and the required `ci` check.
