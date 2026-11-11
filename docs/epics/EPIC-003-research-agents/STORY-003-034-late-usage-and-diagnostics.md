---
type: Story
title: "STORY-003-034 — Late usage and diagnostics"
description: "Record late usage within a fixed window, show each reply's details and prove that diagnostics carry no research content."
generated:
  by: claude-code/claude-opus-5-5
verified:
  by: human:AdrianMastronardi
tags: [story, "comp:llm", "comp:storage", "comp:app", "comp:desktop", "comp:docs"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/236
epic: "EPIC-003"
epic_concept: ./epic.md
components: ["comp:llm", "comp:storage", "comp:app", "comp:desktop", "comp:docs"]
applicable_blocks: ["SPEC-003-039"]
---

# STORY-003-034 — Late usage and diagnostics

## Description

Add `usage_reports` with the 15-minute late-report window, the "Details" view for agent replies, the end-to-end diagnostic marker sweep and the applicable scenario 11 checks.

## Applicable specification

- [SPEC-003-039: Late usage and diagnostics](./epic.md#spec-003-039-late-usage-and-diagnostics)

## Tasks

- [ ] Start after STORY-003-031 is merged and its output is on the base branch: Attention states for the sweep.
- [ ] Start after STORY-003-033 is merged and its output is on the base branch: Memory text for the sweep.
- [ ] Start from `packages/contracts/src/diagnostics.ts`, `packages/main/src/diagnostic-writer.ts` and `config/desktop/diagnostic-cases.json`, and extend these existing boundaries rather than create parallel ones.
- [ ] Write the migration for `usage_reports` (with `report_sha256`, the SHA-256 of the RFC 8785 canonical JSON of `{ attemptId, revision, origin, inputTokens, cachedInputTokens, outputTokens, reasoningTokens, estimated }`, an unknown counter written as `null`, and the date the data service accepted the report), `attempts.usage_report_deadline_at` and `attempts.account_fingerprint` (32 bytes, set only when the attempt dispatches).
- [ ] Compute the account fingerprint in main at dispatch as the SHA-256 of the UTF-8 text `ohtia-account-v1`, a line feed, the connection identifier, a line feed and the account input, which for Sign in with ChatGPT is the `sub` claim of the access token main attaches; return it with the attempt's started event in `provider_event`, report each connection's current fingerprint with its state and model list, and never send the claim, the credential or an email to the data service or the fingerprint to the window, diagnostics or `command_receipts`; test the `api_key` account lines with a fake `api_key` connection, the fake provider declared with the kind `api_key`, whose account input is a random value that replacing its fake key changes.
- [ ] Implement late reports bound to their attempt with replay, conflict, correction and the backwards-clock rejection; declare `late_usage: none` for ChatGPT.
- [ ] Build "Details" for agent messages, opened below the message, as two columns of labelled terms and values in `type.ui.caption`, by the disclosure button "Show details", the second button of the message's actions row after "Copy message", an always-visible quiet icon button with the Lucide `receipt-text` icon, vendored from `lucide-static` 1.66.0 into `packages/renderer/icons/` with its hash in the manifest and the generated `design-icons.ts` and icon mappings updated, whose accessible name and tooltip are its label, which becomes "Hide details" and carries no `aria-expanded` because its label states it; give the notice of every task that ended failed, cancelled or uncertain without saving a message (reply, consultation and synthesis tasks: never dispatched, stopped before any text, refused (STORY-003-036), or failed or uncertain without text) the same button as the last of the buttons below its box, opening "Details" below them, and none to a notice of a task that has not ended or saved a message; read "Details" with the new `reply.details`, given the project and the reply's task (the message's `task_id` or the notice's task), showing "Loading…" marked `aria-busy` while it loads and, if it fails, a danger notice with `octagon-alert`, announced as an alert, "Ohtia couldn't load this reply's details. The reply is still saved.", with "Reload details"; with the labelled terms "Agent", "Operation" (one message "{operation} · version {version}", `{version}` being the instruction version, which a policy-only version does not change, and `{operation}` "Project setup", "Direct guidance", "Search strategy plan", "Plan synthesis" or "Development test"), "Connection" ("{service}" for a `subscription` connection, "{service} · API key" for an `api_key` connection), "Account", "Requested model", "Observed model", "Attempts", "Started", "Ended", "Duration" (in the locale's short unit format, such as "45 sec" in `en-US`), "Input tokens", "Cached input tokens", "Output tokens", "Reasoning tokens", "Usage" ("Reported by {service}", "Reported by {service} after the reply ended", "Estimated by {service}" or, with no reported count, "Not reported by {service}") and "Project memory" ("{n} entries" with plural forms, linked to their versions), times with a medium date and a medium time in the interface locale; the "Account" line from the comparison of the latest dispatched attempt's fingerprint with the connection's current one ("Sent with the account connected now ({email})." with the email from `connection.read`, "Sent with a different {service} account than the one connected now." or "Sent with a {service} account that is no longer connected."; for an `api_key` connection "Sent with the key connected now.", "Sent with your {service} API key that has since been replaced." or "Sent with your {service} API key that is no longer connected."; no "Account" term when no attempt dispatched); models and tokens read "Unknown" when unknown, never 0; for a stopped or cut reply with some reported counts "Usage" reads "Incomplete: {service} reported usage only up to the interruption."
- [ ] Run the marker sweep across every path delivered through STORY-003-033, reading the diagnostic files and the main process's and data service's standard output and error streams, check that no credential marker reaches the SQLite database, its write-ahead log or the ADR-0010 checkpoints, check that the requests the fake provider captures carry no marker from another project, no marker from a conversation record that the attempt's `transfer_manifest` does not record, and none of the fields that refer to state kept by the provider, place markers in a memory entry written from one conversation of the project and in a handoff's note and a selected message, and check that each reaches exactly the requests whose `transfer_manifest` records that entry version, that handoff or that message, with the entry version, handoff and message identities matching the stored records, and run the scenario 11 checks; with the researcher's account, check that a marker sentence written in a conversation of one development project is unknown to Virgilio in a conversation of another project.
- [ ] Apply the documentation amendment of SPEC-003-039: in `docs/design-system.md`, "Iconography", fixed mappings, add the row "Show reply details | `receipt-text`".
- [ ] Build "Details" from the canonical tokens, below STORY-003-010's actions row, and compare it with `epic-003-details.png` and `epic-003-details-states.png`; the EPIC text prevails over a capture.

## Acceptance criteria

- [ ] Late reports inside and outside the window behave as specified and never change anything else (scenario 16).
- [ ] The window does not reset on restart or retry.
- [ ] "Show details" opens "Details" with every term, a slow and a failed `reply.details` show "Loading…" and the failure notice with "Reload details", "Details" shows "Unknown" and never 0 for unknown values, and "Usage" shows its value for complete, interrupted and unreported usage.
- [ ] "Show details" also sits on the notice of each ended task that saved no message (never dispatched, stopped before text, failed and uncertain) and not on waiting or replying notices or those of a task with a saved message; "Operation" shows the instruction version.
- [ ] "Details" shows the right account line for the same account, another account, a replaced key of the fake `api_key` connection and a disconnected service, and the fingerprint never reaches the window, diagnostics or `command_receipts`.
- [ ] A repeated late report has the same `report_sha256` and returns the same answer, and a different one with the same revision is rejected.
- [ ] No marker reaches any diagnostic file or output stream (scenario 15), no credential marker reaches research records or checkpoints, no captured request carries a marker from another project or a field that refers to state kept by the provider, and the scenario 11 checks pass.
- [ ] With the researcher's account, a real reply shows its reported model and tokens and "Sent with the account connected now", a stopped one shows "Unknown" and "Not reported by ChatGPT", and a marker sentence from one project is unknown in another.

## Quality checklist

- [ ] Automated tests pass in all 12 CI cells: Ubuntu 26.04 GNOME and KDE on x86-64 and ARM64, Fedora 44 GNOME and KDE on x86-64, Debian 13 GNOME and KDE on x86-64, Windows on x86-64 and ARM64, and macOS 26 and 27 on ARM64.
- [ ] The story's operations emit `ohtia-log-v1` catalog events with a privacy review, and no prompt, response, tool argument, title, memory text, credential or provider error message reaches diagnostics.
- [ ] Real-account checks run on the x86-64 virtual machines (Windows, Ubuntu 26.04, Fedora 44 and Debian 13) with the researcher's stored session. Each reply's duration and longest silence between provider events are recorded; a reply that uses more than half of its attempt duration, or a silence longer than half of `max_inactivity_ms`, raises that limit: in this story's own block before it merges when this story introduces that version; otherwise, recorded in this story's pull request, in that operation's next planned version that has not merged, whose story applies it before it closes; or, when none is planned, in a new policy-only version that this story adds before it closes. Each operation version this story introduces also takes, before the story closes, every raise that earlier stories recorded for it. A raise of `search_strategy_planning` or `contribution_synthesis` also adds the next plan or consultation limits policy version, as SPEC-003-002 states.
- [ ] The interface meets WCAG 2.2 AA and ADR-0023's eleven selected AAA criteria, with ATAG 2.0 Part B as guidance, and is checked with the keyboard alone (focus order and restoration), a screen reader (names, roles, states and announcements), a 280 CSS px chat width, reflow at 320 CSS px, light and dark themes, forced colors, reduced motion, German, Korean with mixed scripts in the packaged fonts, pseudolocalization, the locale fallback and override, and the native input methods in every text field it adds; each manual screen-reader result names the artifact, platform and journey, and its new text is in every supported locale catalog.
- [ ] "Show details" is an always-visible `receipt-text` icon button after "Copy message", and the last button below the notice of an ended task that saved no message; "Details" shows two caption columns, the duration in the locale's unit format and the `api_key` account lines worded with "your {service} API key"; it is compared with the EPIC's details captures.
- [ ] Catalog text uses the typographic apostrophe ’ (U+2019) and quotation marks “ ”, as `en-US.json` does; this EPIC writes them as straight characters for readability.
- [ ] Its texts with plural forms are ICU plural messages, each count with its own plural selector; if the typed plural rendering contract that `docs/localization.md` requires of plural message producers is not on the base branch yet, this story adds it before its first plural message, and otherwise reuses it.
- [ ] Every notice this story adds holds only its icon and text inside its box; its buttons and links sit `space.2` below the box on the surrounding panel or page surface, never inside it, as `research-presentation.md` requires.
- [ ] Any migration this story adds runs through the existing ADR-0010 checkpoint and recovery path; if a story that runs at the same time merges its migration first, this story renumbers its own to the next free number and updates `manifest.json` and the storage revision list before it merges.
- [ ] Every document under `docs/` that this story amends gets this story's `generated.by` and loses its `verified` declaration, which the researcher adds again after reviewing it, as `AGENTS.md` requires.
- [ ] The change passes `pre-commit run --all-files`, the two-reviewer code review gate in `AGENTS.md` and the required `ci` check.
